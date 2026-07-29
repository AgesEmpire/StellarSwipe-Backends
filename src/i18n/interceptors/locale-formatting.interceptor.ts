/**
 * LocaleFormattingInterceptor (#704)
 *
 * Intercepts outgoing API responses and enriches designated numeric/date fields
 * with locale-aware display values while preserving the original raw values.
 *
 * Locale resolution order:
 *   1. `x-user-locale` request header (explicit user preference)
 *   2. `Accept-Language` request header
 *   3. Default → en-US
 *
 * Unrecognised / unsupported locales fall back to en-US without erroring.
 *
 * Opt-out: decorate a controller or handler with @SkipLocaleFormatting()
 * to bypass this interceptor.
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { LocaleFormatService } from './locale-format.service';

@Injectable()
export class LocaleFormattingInterceptor implements NestInterceptor {
  constructor(private readonly localeFormat: LocaleFormatService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    // Resolve locale: explicit header → Accept-Language → default
    const explicitLocale = req.headers['x-user-locale'] as string | undefined;
    const acceptLanguage = req.headers['accept-language'];
    const locale = this.localeFormat.resolveLocale(explicitLocale ?? acceptLanguage);

    const currency = (req.headers['x-currency'] as string | undefined) ?? 'USD';

    return next.handle().pipe(
      map((data) => this.localeFormat.localizeResponse(data, locale, currency)),
    );
  }
}
