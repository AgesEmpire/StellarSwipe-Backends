#!/usr/bin/env node
/**
 * check-destructive-migrations.js
 *
 * CI gate: scans staged/changed migration files for CRITICAL-severity SQL
 * patterns (DROP TABLE, DROP COLUMN, TRUNCATE, DROP DATABASE, DROP SCHEMA).
 * Exits non-zero if any are found without a corresponding `down()` body,
 * preventing accidental destructive changes from reaching production.
 *
 * Usage: node scripts/check-destructive-migrations.js [file1.ts file2.ts ...]
 * When no files are provided it scans all files in src/database/migrations/.
 */

const fs = require('fs');
const path = require('path');

const CRITICAL_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+SCHEMA\b/i,
];

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'database', 'migrations');

function hasDownMethod(content) {
  // A meaningful down() must contain at least one queryRunner call
  const downMatch = content.match(/async\s+down\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s*\}/);
  if (!downMatch) return false;
  return /queryRunner\.(query|dropTable|dropColumn|addColumn|createTable)/.test(downMatch[1]);
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const findings = [];

  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(content) && !hasDownMethod(content)) {
      findings.push(`  ${pattern.source} detected without a rollback in down()`);
    }
  }

  return findings;
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && f !== 'migration-utils.ts')
      .map((f) => path.join(MIGRATIONS_DIR, f));

let failed = false;

for (const file of files) {
  if (!file.endsWith('.ts')) continue;
  const findings = checkFile(file);
  if (findings.length) {
    console.error(`\n[MIGRATION GATE] Destructive operation without rollback in: ${path.basename(file)}`);
    findings.forEach((f) => console.error(f));
    failed = true;
  }
}

if (failed) {
  console.error('\nAdd a down() implementation or use withRollbackSafety() from migration-utils.ts.');
  console.error('See src/database/migrations/README.md for guidance.\n');
  process.exit(1);
}

console.log(`[MIGRATION GATE] Checked ${files.length} migration file(s) — no unguarded destructive changes found.`);
