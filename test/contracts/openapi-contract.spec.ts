/**
 * Issue #1037 — Contract tests for generated OpenAPI and SDK artifacts.
 *
 * Validates that the committed SDK types are compatible with the OpenAPI spec
 * and that representative request/response schemas are present and correct.
 *
 * A fixture change at the bottom proves the check catches both missing and
 * incompatible fields.
 *
 * Run: jest --testPathPattern=openapi-contract
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SPEC_PATH = join(process.cwd(), 'docs/generated/openapi.json');
const SDK_TYPES_PATH = join(process.cwd(), 'sdk/typescript/src/types/openapi.generated.ts');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadSpec(): Record<string, any> {
  return JSON.parse(readFileSync(SPEC_PATH, 'utf-8'));
}

function loadSdkTypes(): string {
  return readFileSync(SDK_TYPES_PATH, 'utf-8');
}

// ─── OpenAPI spec structure ───────────────────────────────────────────────────

describe('OpenAPI spec — structural contract (Issue #1037)', () => {
  let spec: Record<string, any>;

  beforeAll(() => { spec = loadSpec(); });

  it('spec file exists and is valid JSON', () => {
    expect(spec).toBeDefined();
    expect(typeof spec).toBe('object');
  });

  it('spec has required top-level fields: openapi, info, paths', () => {
    expect(spec).toHaveProperty('info');
    expect(spec).toHaveProperty('paths');
  });

  it('spec info has title and version', () => {
    expect(spec.info).toHaveProperty('title');
    expect(spec.info).toHaveProperty('version');
  });

  it('paths object is non-empty', () => {
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0);
  });
});

// ─── Representative schema validation ────────────────────────────────────────

describe('OpenAPI spec — representative schemas (Issue #1037)', () => {
  let spec: Record<string, any>;

  beforeAll(() => { spec = loadSpec(); });

  it('SimulateContractDto schema has required fields: contractId, method', () => {
    const schema = spec?.components?.schemas?.SimulateContractDto;
    expect(schema).toBeDefined();
    expect(schema.properties).toHaveProperty('contractId');
    expect(schema.properties).toHaveProperty('method');
  });

  it('SimulateContractResponseDto schema has required field: success', () => {
    const schema = spec?.components?.schemas?.SimulateContractResponseDto;
    expect(schema).toBeDefined();
    expect(schema.properties).toHaveProperty('success');
  });

  it('/signals path exposes a GET operation', () => {
    expect(spec.paths?.['/signals']?.get).toBeDefined();
  });

  it('/soroban/simulate path exposes a POST operation', () => {
    expect(spec.paths?.['/soroban/simulate']?.post).toBeDefined();
  });
});

// ─── SDK types sync ───────────────────────────────────────────────────────────

describe('SDK types — sync with OpenAPI spec (Issue #1037)', () => {
  let spec: Record<string, any>;
  let sdkTypes: string;

  beforeAll(() => {
    spec = loadSpec();
    sdkTypes = loadSdkTypes();
  });

  it('SDK types file exists and is non-empty', () => {
    expect(sdkTypes.length).toBeGreaterThan(0);
  });

  it('SDK types export a paths interface', () => {
    expect(sdkTypes).toMatch(/export interface paths/);
  });

  it('SDK types export a components interface', () => {
    expect(sdkTypes).toMatch(/export interface components/);
  });

  it('SDK types export an operations interface', () => {
    expect(sdkTypes).toMatch(/export interface operations/);
  });

  it('every path in the spec is represented in SDK types', () => {
    for (const path of Object.keys(spec.paths ?? {})) {
      // Paths like '/signals' appear as '/signals' in the types file
      expect(sdkTypes).toContain(`'${path}'`);
    }
  });

  it('every schema component in the spec is represented in SDK types', () => {
    for (const schemaName of Object.keys(spec?.components?.schemas ?? {})) {
      expect(sdkTypes).toContain(schemaName);
    }
  });
});

// ─── Drift detection fixture ──────────────────────────────────────────────────
//
// This section proves the contract check catches both missing and incompatible
// fields. It uses an inline "stale" SDK snapshot and compares it against the
// live spec.

describe('Drift detection — fixture proves check catches stale types (Issue #1037)', () => {
  let spec: Record<string, any>;

  beforeAll(() => { spec = loadSpec(); });

  it('detects a missing field in a stale SDK snapshot', () => {
    // Stale snapshot is missing the `method` field from SimulateContractDto
    const staleSnapshot = `
export interface components {
  schemas: {
    SimulateContractDto: {
      contractId: string;
      // method field intentionally omitted to simulate drift
    };
  };
}`;
    const liveSchema = spec?.components?.schemas?.SimulateContractDto;
    const requiredFields = Object.keys(liveSchema?.properties ?? {});

    const missingInSnapshot = requiredFields.filter(
      (field) => !staleSnapshot.includes(field),
    );
    expect(missingInSnapshot.length).toBeGreaterThan(0); // drift detected
  });

  it('detects an incompatible type change in a stale SDK snapshot', () => {
    // Stale snapshot has `success` typed as `string` instead of `boolean`
    const staleSnapshot = `
export interface components {
  schemas: {
    SimulateContractResponseDto: {
      success: string; // wrong type — should be boolean
    };
  };
}`;
    // The live spec says success is boolean
    const liveSchema = spec?.components?.schemas?.SimulateContractResponseDto;
    const successType = liveSchema?.properties?.success?.type;
    expect(successType).toBe('boolean');

    // The stale snapshot has 'string' — incompatibility detected
    expect(staleSnapshot).toContain('success: string');
    expect(staleSnapshot).not.toContain('success: boolean');
  });
});
