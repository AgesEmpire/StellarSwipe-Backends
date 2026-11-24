import { ApolloServerPlugin, GraphQLRequestContext, GraphQLRequestListener } from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { GraphQLError } from 'graphql';
import { Counter, Histogram } from 'prom-client';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';
import { persistedQueryRegistry } from './persisted-query.registry';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const APP_VERSION = process.env.APP_VERSION || 'unknown';

/** Fixed label values for requests that do not resolve to a registered operation. */
const LABEL_UNREGISTERED = 'unregistered';
const LABEL_AD_HOC = 'ad_hoc';
const LABEL_OTHER = 'other';

/** Upper bound on distinct operation_id label values; the registry is code-defined, this guards drift. */
const MAX_OPERATION_LABELS = 200;

/**
 * Issue #1036 — Persisted query enforcement.
 *
 * In production, only queries whose SHA-256 hash is registered in the
 * PersistedQueryRegistry are executed. Unknown hashes are rejected with a
 * PERSISTED_QUERY_NOT_FOUND error that includes the correlation ID for
 * traceability.
 *
 * In non-production environments the check is skipped so developers can
 * send arbitrary queries without pre-registering them.
 *
 * Clients send the hash via the `extensions.persistedQuery.sha256Hash` field
 * (Apollo's automatic persisted queries protocol).
 *
 * Usage metrics (count and latency) are keyed by persisted operation ID and
 * deployment version. Client-supplied hashes and operation text never become
 * label values unless they match a registered operation.
 */
@Plugin()
export class PersistedQueryPlugin implements ApolloServerPlugin {
  private readonly requestsTotal: Counter;
  private readonly requestDuration: Histogram;
  private readonly seenOperationIds = new Set<string>();

  constructor(prometheus: PrometheusService) {
    this.requestsTotal = new Counter({
      name: 'graphql_persisted_operation_requests_total',
      help: 'GraphQL requests by persisted operation ID, deployment version and outcome',
      labelNames: ['operation_id', 'version', 'outcome'],
      registers: [prometheus.registry],
    });

    this.requestDuration = new Histogram({
      name: 'graphql_persisted_operation_duration_seconds',
      help: 'GraphQL request duration by persisted operation ID and deployment version',
      labelNames: ['operation_id', 'version'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [prometheus.registry],
    });
  }

  /** Maps a client-supplied hash to a bounded label value. */
  private operationLabel(hash: string | undefined): string {
    if (!hash) return LABEL_AD_HOC;
    if (!persistedQueryRegistry.has(hash)) return LABEL_UNREGISTERED;
    if (this.seenOperationIds.has(hash)) return hash;
    if (this.seenOperationIds.size >= MAX_OPERATION_LABELS) return LABEL_OTHER;
    this.seenOperationIds.add(hash);
    return hash;
  }

  async requestDidStart(
    ctx: GraphQLRequestContext<Record<string, unknown>>,
  ): Promise<GraphQLRequestListener<Record<string, unknown>>> {
    const startedAt = process.hrtime.bigint();

    return {
      async didResolveOperation({ request, operation }) {
        if (!IS_PRODUCTION) return;

        const hash: string | undefined =
          (request.extensions as any)?.persistedQuery?.sha256Hash;

        if (!hash) return; // no hash sent — allow (client may not use APQ)

        if (!persistedQueryRegistry.has(hash)) {
          const correlationId =
            (ctx.request.http?.headers as any)?.get?.('x-correlation-id') ?? 'unknown';
          console.warn(
            `[persisted-query] unknown hash="${hash}" correlationId="${correlationId}" operation="${operation?.name?.value ?? 'anonymous'}"`,
          );
          throw new GraphQLError('PersistedQueryNotFound', {
            extensions: { code: 'PERSISTED_QUERY_NOT_FOUND', correlationId },
          });
        }
      },

      willSendResponse: async ({ request, response }) => {
        const hash: string | undefined =
          (request.extensions as any)?.persistedQuery?.sha256Hash;
        const labels = { operation_id: this.operationLabel(hash), version: APP_VERSION };
        const failed =
          response.body.kind === 'single' && !!response.body.singleResult.errors?.length;

        this.requestsTotal.inc({ ...labels, outcome: failed ? 'error' : 'ok' });
        this.requestDuration.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1e9);
      },
    };
  }
}
