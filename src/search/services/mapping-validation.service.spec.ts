import {
  compareIndexMapping,
  MappingValidationService,
  IncompatibleMappingError,
} from './mapping-validation.service';
import { IndexMapping } from './index-mapping.interface';

describe('compareIndexMapping', () => {
  const expected: IndexMapping = {
    properties: {
      id: { type: 'keyword' },
      createdAt: { type: 'date' },
      winRate: { type: 'float' },
    },
  };

  it('treats a never-deployed index as compatible, with every field pending creation', () => {
    const result = compareIndexMapping('signals', expected, undefined);

    expect(result.indexMissing).toBe(true);
    expect(result.compatible).toBe(true);
    expect(result.missingInDeployed).toEqual(['id', 'createdAt', 'winRate']);
    expect(result.typeMismatches).toEqual([]);
  });

  it('is compatible when deployed mapping matches expected exactly', () => {
    const deployed: IndexMapping = { properties: { ...expected.properties } };
    const result = compareIndexMapping('signals', expected, deployed);

    expect(result.compatible).toBe(true);
    expect(result.missingInDeployed).toEqual([]);
    expect(result.extraInDeployed).toEqual([]);
    expect(result.typeMismatches).toEqual([]);
  });

  it('treats a new expected field not yet deployed as a compatible addition', () => {
    const deployed: IndexMapping = {
      properties: { id: { type: 'keyword' }, createdAt: { type: 'date' } },
    };
    const result = compareIndexMapping('signals', expected, deployed);

    expect(result.compatible).toBe(true);
    expect(result.missingInDeployed).toEqual(['winRate']);
    expect(result.typeMismatches).toEqual([]);
  });

  it('ignores fields deployed but no longer expected', () => {
    const deployed: IndexMapping = {
      properties: { ...expected.properties, legacyField: { type: 'text' } },
    };
    const result = compareIndexMapping('signals', expected, deployed);

    expect(result.compatible).toBe(true);
    expect(result.extraInDeployed).toEqual(['legacyField']);
  });

  it('flags a type change on a shared field as incompatible', () => {
    const deployed: IndexMapping = {
      properties: {
        id: { type: 'keyword' },
        createdAt: { type: 'date' },
        winRate: { type: 'keyword' }, // was float, now keyword — breaking
      },
    };
    const result = compareIndexMapping('signals', expected, deployed);

    expect(result.compatible).toBe(false);
    expect(result.typeMismatches).toEqual([
      { field: 'winRate', expectedType: 'float', deployedType: 'keyword' },
    ]);
  });
});

describe('MappingValidationService', () => {
  function buildClient(mappingsByIndex: Record<string, IndexMapping | null>) {
    return {
      indices: {
        exists: jest.fn().mockImplementation(async ({ index }: { index: string }) => {
          return mappingsByIndex[index] !== null && mappingsByIndex[index] !== undefined;
        }),
        getMapping: jest.fn().mockImplementation(async ({ index }: { index: string }) => {
          return { [index]: { mappings: mappingsByIndex[index] } };
        }),
      },
    } as any;
  }

  it('validateAllMappings reports one result per known index', async () => {
    const service = new MappingValidationService();
    const client = buildClient({ signals: null, providers: null, content: null });

    const results = await service.validateAllMappings(client);

    expect(results.map((r) => r.index).sort()).toEqual(['content', 'providers', 'signals']);
    expect(results.every((r) => r.indexMissing)).toBe(true);
  });

  it('assertDeploymentSafe resolves when every index is compatible', async () => {
    const service = new MappingValidationService();
    const client = buildClient({ signals: null, providers: null, content: null });

    await expect(service.assertDeploymentSafe(client)).resolves.toBeDefined();
  });

  it('assertDeploymentSafe throws IncompatibleMappingError on breaking drift', async () => {
    const service = new MappingValidationService();
    const client = buildClient({
      signals: { properties: { id: { type: 'text' } } }, // expected keyword, deployed text
      providers: null,
      content: null,
    });

    await expect(service.assertDeploymentSafe(client)).rejects.toThrow(IncompatibleMappingError);
  });
});
