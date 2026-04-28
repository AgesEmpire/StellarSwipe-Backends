import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { Logger } from '@nestjs/common';
import { Plugin } from '@nestjs/apollo';

interface RequestContext {
  req?: { user?: { id?: string } };
  operationStartMs?: number;
}

/**
 * Apollo plugin that logs:
 *  - operation name + user ID at request start
 *  - duration + error count at request end
 *
 * Register in GraphqlModule providers list.
 */
@Plugin()
export class GqlLoggingPlugin implements ApolloServerPlugin<RequestContext> {
  private readonly logger = new Logger('GraphQL');

  async requestDidStart(
    requestContext: GraphQLRequestContext<RequestContext>,
  ): Promise<GraphQLRequestListener<RequestContext>> {
    const { context, request } = requestContext;
    context.operationStartMs = Date.now();

    const userId = context.req?.user?.id ?? 'anonymous';
    const opName = request.operationName ?? '(anonymous operation)';

    this.logger.debug(`→ ${opName} | user: ${userId}`);

    const logger = this.logger;

    return {
      async didEncounterErrors({ errors, context: ctx }) {
        const duration = Date.now() - (ctx.operationStartMs ?? 0);
        errors.forEach((err) =>
          logger.warn(`✗ ${opName} [${duration}ms] — ${err.message}`),
        );
      },

      async willSendResponse({ context: ctx, response }) {
        const duration = Date.now() - (ctx.operationStartMs ?? 0);
        const hasErrors =
          response.body.kind === 'single' && !!response.body.singleResult.errors?.length;

        if (!hasErrors) {
          logger.debug(`✓ ${opName} [${duration}ms]`);
        }
      },
    };
  }
}
