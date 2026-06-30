import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, of, EMPTY } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import * as crypto from 'crypto';
import { Request } from 'express';
import { ServerResponse } from 'http';

@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<ServerResponse>();

    return next.handle().pipe(
      switchMap((data) => {
        const etag = `"${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}"`;
        response.setHeader('ETag', etag);
        response.setHeader('Cache-Control', 'no-cache');

        const ifNoneMatch = request.headers['if-none-match'];
        if (ifNoneMatch === etag) {
          response.statusCode = 304;
          response.end();
          return EMPTY;
        }

        return of(data);
      }),
    );
  }
}
