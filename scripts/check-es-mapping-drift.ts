/**
 * scripts/check-es-mapping-drift.ts
 *
 * Deployment gate for Elasticsearch index mappings (issue #1365).
 *
 * Compares the mappings the application code expects (see
 * src/search/services/elasticsearch-mappings.constants.ts) against what is
 * actually deployed on the target Elasticsearch cluster, and fails with
 * actionable detail if any field has incompatibly changed type. Intended to
 * run as a pre-traffic-switch step in CI/CD (e.g. before `blue-green-deploy.sh`
 * flips traffic to the new color), so a breaking mapping change is caught
 * before it reaches production.
 *
 * Run via:
 *   npx ts-node -r tsconfig-paths/register scripts/check-es-mapping-drift.ts
 *
 * or via the npm script:
 *   npm run es:check-mapping-drift
 *
 * Reads connection details from the same env vars as SearchModule:
 *   ELASTICSEARCH_NODE (default http://localhost:9200)
 *   ELASTICSEARCH_USERNAME (default elastic)
 *   ELASTICSEARCH_PASSWORD (default changeme)
 */

import { Client } from '@elastic/elasticsearch';
import {
  MappingValidationService,
  IncompatibleMappingError,
} from '../src/search/services/mapping-validation.service';

async function main() {
  const node = process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';
  const username = process.env.ELASTICSEARCH_USERNAME ?? 'elastic';
  const password = process.env.ELASTICSEARCH_PASSWORD ?? 'changeme';

  const client = new Client({
    node,
    auth: { username, password },
  });

  const validator = new MappingValidationService();

  try {
    const results = await validator.assertDeploymentSafe(client);

    for (const result of results) {
      if (result.indexMissing) {
        console.log(`[es-mapping-drift] "${result.index}": index not deployed yet (will be created on first boot)`);
      } else if (result.missingInDeployed.length > 0) {
        console.log(
          `[es-mapping-drift] "${result.index}": ${result.missingInDeployed.length} new field(s) pending a mapping update — ${result.missingInDeployed.join(', ')}`,
        );
      } else {
        console.log(`[es-mapping-drift] "${result.index}": up to date`);
      }
    }

    console.log('[es-mapping-drift] PASS — no incompatible mapping drift detected');
    process.exit(0);
  } catch (error) {
    if (error instanceof IncompatibleMappingError) {
      console.error('[es-mapping-drift] FAIL — incompatible mapping drift detected');
      console.error(error.message);
      process.exit(1);
    }

    console.error('[es-mapping-drift] FAIL — could not validate Elasticsearch mappings');
    console.error(error);
    process.exit(1);
  }
}

main();
