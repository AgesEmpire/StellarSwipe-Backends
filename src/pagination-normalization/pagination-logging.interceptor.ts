import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { NormalizedPage } from './pagination.dto';

function isNormalizedPage(body: unknown): body is NormalizedPage<unknown> {
  return (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    'pageInfo' in (body as Record<string, unknown>)
  );
}

/**
 * Attach to any paginated list endpoint so page/cursor/total-count shape is
 * observable in logs (route, requested limit, result size, hasNextPage)
 * without every controller re-implementing the same logging.
 */
@Injectable()
export class PaginationLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Pagination');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const route = req?.route?.path ?? req?.url;

    return next.handle().pipe(
      tap((body) => {
        if (!isNormalizedPage(body)) return;
        const { pageInfo, data } = body;
        this.logger.log(
          `${route} returned=${data.length} page=${pageInfo.page ?? '-'} ` +
            `cursor=${pageInfo.cursor ?? '-'} nextCursor=${pageInfo.nextCursor ?? '-'} ` +
            `totalCount=${pageInfo.totalCount ?? '-'} hasNextPage=${pageInfo.hasNextPage}`,
        );
      }),
    );
  }
}
