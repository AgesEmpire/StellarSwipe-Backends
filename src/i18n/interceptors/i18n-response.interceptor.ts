import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { I18nAppService } from '../i18n.service';

@Injectable()
export class I18nResponseInterceptor implements NestInterceptor {
  constructor(private readonly i18nService: I18nAppService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const lang = (request as any).language || 'en';

    return next.handle().pipe(
      map(async (data) => {
        if (data && typeof data === 'object') {
          return this.translateObject(data, lang);
        }
        return data;
      }),
    );
  }

  private async translateObject(obj: any, lang: string): Promise<any> {
    if (Array.isArray(obj)) {
      return Promise.all(obj.map((item) => this.translateObject(item, lang)));
    }

    if (obj && typeof obj === 'object') {
      const translated: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'message' && typeof value === 'string') {
          // Translate message fields
          translated[key] = await this.i18nService.translate(value, lang);
        } else if (typeof value === 'object') {
          translated[key] = await this.translateObject(value, lang);
        } else {
          translated[key] = value;
        }
      }
      return translated;
    }

    return obj;
  }
}
