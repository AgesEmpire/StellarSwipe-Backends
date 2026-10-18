import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
  RequestTimeoutException,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

export const RESOLVER_TIMEOUT_KEY = 'graphql_resolver_timeout_ms';

/** Env var / default consumed when a resolver doesn't set its own budget via `@ResolverTimeout`. */
const DEFAULT_RESOLVER_TIMEOUT_MS = 5000;

/**
 * Gives a resolver query, mutation, or field an execution-time budget
 * (issue #1385: "Add execution time limits for expensive GraphQL
 * resolvers"). Apply to resolvers that do aggregation, ranking, or
 * cross-service fan-out — cheap, single-row lookups don't need one.
 *
 * @example
 *   @ResolverTimeout(3000) // 3 seconds
 *   @UseInterceptors(ResolverTimeoutInterceptor)
 *   async expensiveStats() { ... }
 */
export const ResolverTimeout = (ms: number) => SetMetadata(RESOLVER_TIMEOUT_KEY, ms);

/**
 * Enforces the execution budget declared by `@ResolverTimeout(ms)` (falling
 * back to `GRAPHQL_RESOLVER_TIMEOUT_MS`, default 5s, when the resolver
 * doesn't set one) on the GraphQL query/mutation/field it decorates.
 *
 * Node has no safe, general way to abort an arbitrary in-flight promise, so
 * "stopping" over-budget work here means the RxJS `timeout()` operator
 * unsubscribes from the pending resolver result the instant the budget
 * elapses — the slow call is no longer awaited or allowed to shape the
 * response, and the request fails fast and deterministically instead of
 * hanging the client on a resolver that might never return in a reasonable
 * time. The resulting `RequestTimeoutException` is mapped by
 * `GraphqlExceptionFilter` to a GraphQL error with a stable
 * `REQUEST_TIMEOUT` extension code, so timeouts look like every other
 * structured GraphQL error to clients.
 */
@Injectable()
export class ResolverTimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const timeoutMs = this.resolveTimeoutMs(context);
    const fieldName = this.describeField(context);

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                `Resolver "${fieldName}" exceeded its ${timeoutMs}ms execution budget`,
              ),
          );
        }
        return throwError(() => err);
      }),
    );
  }

  private resolveTimeoutMs(context: ExecutionContext): number {
    const handlerTimeout = this.reflector.get<number>(RESOLVER_TIMEOUT_KEY, context.getHandler());
    if (handlerTimeout) return handlerTimeout;

    const classTimeout = this.reflector.get<number>(RESOLVER_TIMEOUT_KEY, context.getClass());
    if (classTimeout) return classTimeout;

    const configured = this.configService?.get<number>('GRAPHQL_RESOLVER_TIMEOUT_MS');
    if (configured && configured > 0) return configured;

    const fromEnv = Number(process.env.GRAPHQL_RESOLVER_TIMEOUT_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

    return DEFAULT_RESOLVER_TIMEOUT_MS;
  }

  private describeField(context: ExecutionContext): string {
    try {
      const info = GqlExecutionContext.create(context).getInfo<{
        parentType?: { name?: string };
        fieldName?: string;
      }>();
      if (info?.fieldName) {
        return info.parentType?.name ? `${info.parentType.name}.${info.fieldName}` : info.fieldName;
      }
    } catch {
      // Not resolvable as a GraphQL execution context — fall back below.
    }
    return context.getHandler()?.name || 'unknown';
  }
}
