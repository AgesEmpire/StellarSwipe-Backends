#!/usr/bin/env ts-node
/**
 * DB Anonymization Script (#700)
 *
 * ⚠️  WARNING: Run this ONLY against a snapshot/dump, NEVER against production directly.
 *
 * Workflow:
 *   1. pg_dump production -> staging_dump.sql
 *   2. Restore dump into isolated staging DB (psql staging_db < staging_dump.sql)
 *   3. Run: ts-node scripts/anonymize-db.ts
 *   4. The staging DB now contains anonymized data safe for developer access.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host:5432/staging_db ts-node scripts/anonymize-db.ts
 */

import { Client } from 'pg';
import * as crypto from 'crypto';

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  process.exit(1);
}

// Salt is fixed per-run so anonymization is deterministic within a snapshot,
// preserving referential integrity (same input → same output).
const SALT = process.env['ANON_SALT'] ?? 'stellarswipe-staging-anon';

/** One-way deterministic hash that stays consistent within a run */
function deterministicHash(value: string, prefix = ''): string {
  return (
    prefix +
    crypto
      .createHmac('sha256', SALT)
      .update(value)
      .digest('hex')
      .slice(0, 16)
  );
}

function anonymizeEmail(email: string): string {
  const [local, domain] = email.split('@');
  const hashedLocal = deterministicHash(local, 'user_');
  return `${hashedLocal}@${domain ?? 'example.com'}`;
}

function anonymizeName(name: string): string {
  return deterministicHash(name, 'name_');
}

function anonymizeWalletLabel(label: string): string {
  return deterministicHash(label, 'wallet_');
}

function anonymizePhone(phone: string): string {
  // Preserve format length but hash digits
  return '+' + deterministicHash(phone).replace(/\D/g, '').slice(0, 10);
}

// ──────────────────────────────────────────────
// PII field definitions
// Each entry: { table, column, type, pkColumn }
// Non-PII columns (amounts, timestamps, statuses) are left untouched.
// ──────────────────────────────────────────────

interface PiiField {
  table: string;
  column: string;
  type: 'email' | 'name' | 'wallet_label' | 'phone';
  pkColumn?: string;
}

const PII_FIELDS: PiiField[] = [
  // users table
  { table: 'users', column: 'email', type: 'email', pkColumn: 'id' },
  { table: 'users', column: 'first_name', type: 'name', pkColumn: 'id' },
  { table: 'users', column: 'last_name', type: 'name', pkColumn: 'id' },
  { table: 'users', column: 'phone_number', type: 'phone', pkColumn: 'id' },
  // kyc table
  { table: 'kyc', column: 'full_name', type: 'name', pkColumn: 'id' },
  { table: 'kyc', column: 'email', type: 'email', pkColumn: 'id' },
  // wallet labels
  { table: 'wallets', column: 'label', type: 'wallet_label', pkColumn: 'id' },
  // provider profiles
  {
    table: 'provider_profiles',
    column: 'display_name',
    type: 'name',
    pkColumn: 'id',
  },
  {
    table: 'provider_profiles',
    column: 'contact_email',
    type: 'email',
    pkColumn: 'id',
  },
  // audit log (can contain email in actor_email)
  {
    table: 'audit_logs',
    column: 'actor_email',
    type: 'email',
    pkColumn: 'id',
  },
];

// ──────────────────────────────────────────────
// Core anonymizer
// ──────────────────────────────────────────────

async function anonymizeTable(client: Client, field: PiiField): Promise<void> {
  const pk = field.pkColumn ?? 'id';

  // Check table/column exists before touching it
  const existsResult = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) AS exists`,
    [field.table, field.column],
  );
  if (!existsResult.rows[0]?.exists) {
    console.log(`  ⚠️  Skipping ${field.table}.${field.column} (column not found)`);
    return;
  }

  // Fetch current values (non-null only)
  const rows = await client.query<Record<string, string>>(
    `SELECT ${pk}, ${field.column} FROM ${field.table} WHERE ${field.column} IS NOT NULL`,
  );

  if (rows.rowCount === 0) {
    console.log(`  ✓  ${field.table}.${field.column} — 0 rows`);
    return;
  }

  // Build bulk update as a VALUES list for efficiency
  const values: string[] = [];
  const params: string[] = [];
  let paramIdx = 1;

  for (const row of rows.rows) {
    const original = row[field.column] as string;
    let anonymized: string;
    switch (field.type) {
      case 'email':
        anonymized = anonymizeEmail(original);
        break;
      case 'phone':
        anonymized = anonymizePhone(original);
        break;
      case 'wallet_label':
        anonymized = anonymizeWalletLabel(original);
        break;
      default:
        anonymized = anonymizeName(original);
    }
    values.push(`($${paramIdx++}::uuid, $${paramIdx++})`);
    params.push(row[pk] as string, anonymized);
  }

  const sql = `
    UPDATE ${field.table} AS t
    SET ${field.column} = v.new_val
    FROM (VALUES ${values.join(',')}) AS v(pk, new_val)
    WHERE t.${pk}::text = v.pk::text
  `;

  await client.query(sql, params);
  console.log(`  ✓  ${field.table}.${field.column} — ${rows.rowCount} rows anonymized`);
}

async function main(): Promise<void> {
  // Safety guard: refuse to run if DATABASE_URL looks like production
  if (
    DATABASE_URL?.includes('production') ||
    DATABASE_URL?.includes('prod') && !DATABASE_URL?.includes('staging')
  ) {
    console.error(
      'ERROR: DATABASE_URL appears to point to production. Aborting.\n' +
      'This script must only run against a restored snapshot/staging DB.',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('Connected to database.\n');

  try {
    await client.query('BEGIN');

    for (const field of PII_FIELDS) {
      console.log(`Processing ${field.table}.${field.column}...`);
      await anonymizeTable(client, field);
    }

    await client.query('COMMIT');
    console.log('\n✅ Anonymization complete. All changes committed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error during anonymization, transaction rolled back:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
