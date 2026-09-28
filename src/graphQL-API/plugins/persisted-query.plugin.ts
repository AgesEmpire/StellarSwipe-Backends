import { ApolloServerPlugin, GraphQLRequestContext, GraphQLRequestListener } from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { GraphQLError } from 'graphql';
import { persistedQueryRegistry } from './persisted-query.registry';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
 */
@Plugin()
export class PersistedQueryPlugin implements ApolloServerPlugin {
  async requestDidStart(
    ctx: GraphQLRequestContext<Record<string, unknown>>,
  ): Promise<GraphQLRequestListener<Record<string, unknown>>> {
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
    };
  }
}
