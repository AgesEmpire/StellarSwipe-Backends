import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { Logger } from '@nestjs/common';
import { Plugin } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';

interface RequestContext {
  operationStartMs?: number;
}

const DEFAULT_MIN_COMPRESSIBLE_BYTES = 1024; // 1 KB, matches compression.config.ts threshold

/**
 * Marks large GraphQL responses (report/batch-style queries in particular)
 * as compression-eligible and makes sure caches downstream of this server
 * don't serve a gzip/br body to a client that never asked for one.
 *
 * The actual byte-level gzip/brotli encoding happens in the Express
 * `compression()` middleware registered in `main.ts` — it sits in front of
 * the whole HTTP stack, GraphQL included, and already compresses any
 * response whose `Content-Type` matches `compressionConfig`'s filter
 * (extended to include `application/graphql-response+json`).
 *
 * This plugin's job is the part that middleware can't do on its own:
 *  - Set `Vary: Accept-Encoding` explicitly on the GraphQL response so a
 *    CDN/reverse-proxy cache keys the compressed and uncompressed variants
 *    separately, instead of accidentally serving a gzipped body to a client
 *    that sent no `Accept-Encoding` header (this is what "breaks existing
 *    clients or caching pipelines" in practice).
 *  - Emit an `x-graphql-response-bytes` header + debug log so operators can
 *    see which operations are producing large, compression-worthy payloads.
 */
@Plugin()
export class GqlCompressionPlugin implements ApolloServerPlugin<RequestContext> {
  private readonly logger = new Logger('GraphQL.Compression');
  private readonly minCompressibleBytes: number;

  constructor(configService: ConfigService) {
    this.minCompressibleBytes =
      configService.get<number>('GRAPHQL_COMPRESSION_MIN_BYTES') ??
      DEFAULT_MIN_COMPRESSIBLE_BYTES;
  }

  async requestDidStart(
    requestContext: GraphQLRequestContext<RequestContext>,
  ): Promise<GraphQLRequestListener<RequestContext>> {
    const { context, request } = requestContext;
    context.operationStartMs = Date.now();
    const opName = request.operationName ?? '(anonymous operation)';
    const logger = this.logger;
    const minCompressibleBytes = this.minCompressibleBytes;

    return {
      async willSendResponse({ response }) {
        if (response.body.kind !== 'single') {
          // Incremental/@defer responses stream multiple parts; each part is
          // small and already handled by the HTTP transport, so skip those.
          return;
        }

        const { data, errors } = response.body.singleResult;
        if (!data) return;

        const serialisedBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');

        // Always advertise that response representation can vary by
        // encoding, even for small payloads — this is cheap and keeps
        // downstream caches correct regardless of size.
        response.http?.headers.set('Vary', 'Accept-Encoding');

        if (serialisedBytes >= minCompressibleBytes) {
          response.http?.headers.set(
            'x-graphql-response-bytes',
            String(serialisedBytes),
          );

          if (!errors?.length) {
            logger.debug(
              `${opName} produced a ${serialisedBytes}-byte response (compression-eligible)`,
            );
          }
        }
      },
    };
  }
}
