import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { IndexMapping } from './index-mapping.interface';
import { EXPECTED_INDEX_MAPPINGS } from './elasticsearch-mappings.constants';

export interface MappingFieldTypeMismatch {
  field: string;
  expectedType: string;
  deployedType: string;
}

export interface IndexMappingValidationResult {
  index: string;
  /** True when the index hasn't been deployed yet — nothing to compare against. */
  indexMissing: boolean;
  /** Fields the application expects that aren't deployed yet. Safe: addable via a mapping update. */
  missingInDeployed: string[];
  /** Fields deployed but not expected by the application. Informational only. */
  extraInDeployed: string[];
  /** Fields whose deployed type differs from the expected type. Breaking — requires reindexing. */
  typeMismatches: MappingFieldTypeMismatch[];
  /** False when `typeMismatches` is non-empty; true otherwise (missing/extra fields are compatible). */
  compatible: boolean;
}

function flattenPropertyType(property: any): string | undefined {
  if (!property || typeof property !== 'object') {
    return undefined;
  }
  return property.type;
}

/**
 * Pure comparison between an expected (application-defined) mapping and a
 * deployed (live Elasticsearch) mapping. Exported standalone so it can be
 * unit tested, and reused by a CLI/deployment check, without needing a live
 * Elasticsearch connection or Nest's DI container.
 */
export function compareIndexMapping(
  indexName: string,
  expected: IndexMapping,
  deployed: IndexMapping | undefined,
): IndexMappingValidationResult {
  if (!deployed) {
    return {
      index: indexName,
      indexMissing: true,
      missingInDeployed: Object.keys(expected.properties),
      extraInDeployed: [],
      typeMismatches: [],
      compatible: true,
    };
  }

  const expectedFields = expected.properties ?? {};
  const deployedFields = deployed.properties ?? {};

  const missingInDeployed: string[] = [];
  const typeMismatches: MappingFieldTypeMismatch[] = [];

  for (const [field, expectedProperty] of Object.entries(expectedFields)) {
    const deployedProperty = deployedFields[field];
    if (deployedProperty === undefined) {
      missingInDeployed.push(field);
      continue;
    }

    const expectedType = flattenPropertyType(expectedProperty);
    const deployedType = flattenPropertyType(deployedProperty);
    if (expectedType && deployedType && expectedType !== deployedType) {
      typeMismatches.push({ field, expectedType, deployedType });
    }
  }

  const extraInDeployed = Object.keys(deployedFields).filter(
    (field) => !(field in expectedFields),
  );

  return {
    index: indexName,
    indexMissing: false,
    missingInDeployed,
    extraInDeployed,
    typeMismatches,
    compatible: typeMismatches.length === 0,
  };
}

/** Thrown by `assertDeploymentSafe` when one or more indices have incompatible mapping drift. */
export class IncompatibleMappingError extends Error {
  constructor(public readonly results: IndexMappingValidationResult[]) {
    super(IncompatibleMappingError.formatMessage(results));
    this.name = 'IncompatibleMappingError';
  }

  private static formatMessage(results: IndexMappingValidationResult[]): string {
    const incompatible = results.filter((r) => !r.compatible);
    const details = incompatible
      .map((r) => {
        const mismatches = r.typeMismatches
          .map((m) => `${m.field} (expected "${m.expectedType}", deployed "${m.deployedType}")`)
          .join(', ');
        return `  - ${r.index}: ${mismatches}`;
      })
      .join('\n');
    return (
      `Incompatible Elasticsearch mapping drift detected in ${incompatible.length} index/indices:\n` +
      details +
      '\n\nThese fields changed type in the application mapping but the deployed index cannot be ' +
      'updated in place. Reindex (or create a new index and alias-swap) before traffic switches over.'
    );
  }
}

/**
 * Validates deployed Elasticsearch index mappings against the mappings the
 * application expects, to catch incompatible drift (e.g. a field's type
 * changed) before a deployment switches traffic to the new code.
 */
@Injectable()
export class MappingValidationService {
  private readonly logger = new Logger(MappingValidationService.name);

  /**
   * Compares every known expected mapping (signals, providers, content)
   * against what's currently deployed on the given client.
   */
  async validateAllMappings(client: Client): Promise<IndexMappingValidationResult[]> {
    const results: IndexMappingValidationResult[] = [];
    for (const [indexName, expectedMapping] of Object.entries(EXPECTED_INDEX_MAPPINGS)) {
      results.push(await this.validateIndexMapping(client, indexName, expectedMapping));
    }
    return results;
  }

  async validateIndexMapping(
    client: Client,
    indexName: string,
    expectedMapping: IndexMapping,
  ): Promise<IndexMappingValidationResult> {
    const exists = await client.indices.exists({ index: indexName });
    if (!exists) {
      return compareIndexMapping(indexName, expectedMapping, undefined);
    }

    const response = await client.indices.getMapping({ index: indexName });
    // The response is keyed by the concrete index name (which may differ from
    // an alias); take the first (and typically only) entry's mappings.
    const deployedMapping = Object.values(response)[0]?.mappings as IndexMapping | undefined;

    return compareIndexMapping(indexName, expectedMapping, deployedMapping);
  }

  /**
   * Runs the full comparison and throws `IncompatibleMappingError` (with
   * actionable per-field detail) if any index has incompatible drift.
   * Intended to be called as a deployment gate before traffic switches over.
   */
  async assertDeploymentSafe(client: Client): Promise<IndexMappingValidationResult[]> {
    const results = await this.validateAllMappings(client);
    const incompatible = results.filter((r) => !r.compatible);

    if (incompatible.length > 0) {
      const error = new IncompatibleMappingError(results);
      this.logger.error(error.message);
      throw error;
    }

    for (const result of results) {
      if (result.missingInDeployed.length > 0) {
        this.logger.log(
          `Index "${result.index}" has ${result.missingInDeployed.length} new field(s) pending a mapping update: ${result.missingInDeployed.join(', ')}`,
        );
      }
    }

    this.logger.log('Elasticsearch mapping validation passed: no incompatible drift detected');
    return results;
  }
}
