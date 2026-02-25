import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ProductAnalyticsService } from '../product-analytics.service';

export const TRACK_EVENT_KEY = 'trackEvent';
export const TRACK_PAGE_KEY = 'trackPage';

/** Metadata for @TrackEvent decorator */
export interface TrackEventMeta {
  name: string;
  properties?: (req: any, res: any) => Record<string, unknown>;
}

/**
 * Decorator: manually specify an event to track for a controller method.
 *
 * @example
 * @TrackEvent({ name: 'Feed Viewed', properties: (req) => ({ filter_active: !!req.query.filter }) })
 * @Get('feed')
 * getFeed() {}
 */
export const TrackEvent = (meta: TrackEventMeta) =>
  Reflect.metadata(TRACK_EVENT_KEY, meta);

/**
 * NestJS interceptor that:
 *  1. Reads @TrackEvent metadata from the handler
 *  2. Fires the specified analytics event after a successful response
 *  3. Never blocks the response or throws on failure
 */
@Injectable()
export class AnalyticsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AnalyticsInterceptor.name);

  constructor(
    private readonly analytics: ProductAnalyticsService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<TrackEventMeta | undefined>(
      TRACK_EVENT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          if (!userId) return;
          const properties = meta.properties?.(request, responseData) ?? {};
          void this.analytics.track(userId, meta.name as any, {
            ...properties,
            response_time_ms: Date.now() - startedAt,
          });
        },
        error: () => {
          // Don't track on error responses
        },
      }),
    );
  }
}
