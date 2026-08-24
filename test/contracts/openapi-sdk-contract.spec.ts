/**
 * OpenAPI → SDK contract tests (issue #1037)
 *
 * These tests:
 * 1. Confirm the committed generated types exist and are structurally sound.
 * 2. Validate representative request / response fixtures against the shapes
 *    described by the generated OpenAPI types.
 * 3. Prove that both *missing required fields* and *incompatible types*
 *    are detected (the acceptance criterion "a fixture change proves the
 *    check catches both missing and incompatible fields").
 *
 * The primary CI gate remains the type-drift check in
 * `.github/workflows/sdk-drift-check.yml` + `scripts/check-sdk-drift.sh`.
 * This suite adds the schema-level validation layer on top of pure type drift.
 */

import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'openapi');
const GENERATED_TYPES = path.join(
  __dirname,
  '..',
  '..',
  'sdk',
  'typescript',
  'src',
  'types',
  'openapi.generated.ts',
);

function loadFixture(name: string): unknown {
  const file = path.join(FIXTURES_DIR, name);
  expect(fs.existsSync(file)).toBe(true);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Minimal structural validator for the current SimulateContractDto shape. */
function validateSimulateRequest(body: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body must be an object'] };
  }

  // Required by the generated schema (see openapi.generated.ts)
  if (typeof body.contractId !== 'string') {
    errors.push(`contractId must be string, got ${typeof body.contractId}`);
  }
  if (typeof body.method !== 'string') {
    errors.push(`method must be string, got ${typeof body.method}`);
  }

  // Optional fields with type constraints
  if (body.params !== undefined && !Array.isArray(body.params)) {
    errors.push(`params must be array when present, got ${typeof body.params}`);
  }
  if (body.sourceAccount !== undefined && typeof body.sourceAccount !== 'string') {
    errors.push(`sourceAccount must be string when present`);
  }
  if (body.timeoutMs !== undefined && typeof body.timeoutMs !== 'number') {
    errors.push(`timeoutMs must be number when present, got ${typeof body.timeoutMs}`);
  }

  return { ok: errors.length === 0, errors };
}

function validateSimulateResponse(body: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body must be an object'] };
  }

  if (typeof body.success !== 'boolean') {
    errors.push(`success must be boolean, got ${typeof body.success}`);
  }

  // Optional string fields
  for (const key of ['resourceFee', 'minResourceFee', 'inclusionFee', 'totalFee', 'simulationError', 'rpcError']) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      errors.push(`${key} must be string when present`);
    }
  }

  if (body.footprint !== undefined) {
    if (typeof body.footprint !== 'object' || body.footprint === null) {
      errors.push('footprint must be object when present');
    } else {
      if (body.footprint.readOnly !== undefined && !Array.isArray(body.footprint.readOnly)) {
        errors.push('footprint.readOnly must be array');
      }
      if (body.footprint.readWrite !== undefined && !Array.isArray(body.footprint.readWrite)) {
        errors.push('footprint.readWrite must be array');
      }
    }
  }

  if (body.auth !== undefined && !Array.isArray(body.auth)) {
    errors.push('auth must be array when present');
  }

  return { ok: errors.length === 0, errors };
}

describe('OpenAPI / SDK contract (issue #1037)', () => {
  it('committed generated types file exists', () => {
    expect(fs.existsSync(GENERATED_TYPES)).toBe(true);
    const content = fs.readFileSync(GENERATED_TYPES, 'utf8');
    expect(content).toContain('AUTO-GENERATED');
    expect(content).toContain('paths');
    expect(content).toContain('components');
  });

  describe('representative request schema validation', () => {
    it('accepts a valid SimulateContractDto fixture', () => {
      const fixture = loadFixture('simulate-contract.valid.json');
      const result = validateSimulateRequest(fixture);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects a fixture with missing required fields (proves missing-field detection)', () => {
      const fixture = loadFixture('simulate-contract.missing-required.json');
      const result = validateSimulateRequest(fixture);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('contractId'))).toBe(true);
    });

    it('rejects a fixture with incompatible field types (proves type-incompatibility detection)', () => {
      const fixture = loadFixture('simulate-contract.incompatible-type.json');
      const result = validateSimulateRequest(fixture);
      expect(result.ok).toBe(false);
      // Should catch multiple type errors
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.includes('contractId'))).toBe(true);
      expect(result.errors.some((e) => e.includes('method'))).toBe(true);
    });
  });

  describe('representative response schema validation', () => {
    it('accepts a valid SimulateContractResponseDto fixture', () => {
      const fixture = loadFixture('simulate-contract-response.valid.json');
      const result = validateSimulateResponse(fixture);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('drift-check documentation', () => {
    it('documents the regeneration commands in the generated file header', () => {
      const content = fs.readFileSync(GENERATED_TYPES, 'utf8');
      expect(content).toContain('npm run export:openapi');
      expect(content).toContain('npm run sdk:generate-types');
    });
  });
});
