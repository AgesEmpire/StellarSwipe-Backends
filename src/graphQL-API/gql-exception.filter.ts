import { Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { GqlExceptionFilter, GqlArgumentsHost } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

/**
 * Catches any exception thrown in a resolver and re-throws it as a
 * structured GraphQLError with a stable `code` extension.
 *
 * Register in AppModule providers:
 *   { provide: APP_FILTER, useClass: GqlExceptionFilter }
 */
@Catch()
export class GraphqlExceptionFilter implements GqlExceptionFilter {
  private readonly logger = new Logger(GraphqlExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    GqlArgumentsHost.create(host);

    if (exception instanceof GraphQLError) return exception;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as string | Record<string, unknown>;
      const message =
        typeof response === 'string' ? response : (response.message as string) ?? exception.message;

      this.logger.warn(`[GQL] HTTP ${status} — ${message}`);

      return new GraphQLError(message, {
        extensions: {
          code: httpStatusToGqlCode(status),
          status,
        },
      });
    }

    // Unknown / internal error
    const msg = exception instanceof Error ? exception.message : 'Internal server error';
    this.logger.error(`[GQL] Unhandled exception: ${msg}`, (exception as Error)?.stack);

    return new GraphQLError(
      process.env.NODE_ENV === 'production' ? 'Internal server error' : msg,
      { extensions: { code: 'INTERNAL_SERVER_ERROR' } },
    );
  }
}

function httpStatusToGqlCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_SERVER_ERROR',
  };
  return map[status] ?? 'INTERNAL_SERVER_ERROR';
}
