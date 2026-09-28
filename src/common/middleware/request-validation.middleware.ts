import {
  Injectable,
  NestMiddleware,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Content types accepted for requests that carry a body.
 * Multipart is included for file-upload endpoints.
 */
const ALLOWED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
];

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB
const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE']);

@Injectable()
export class RequestValidationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      throw new PayloadTooLargeException({
        statusCode: 413,
        message: `Request body exceeds maximum allowed size of ${MAX_BODY_BYTES} bytes`,
        error: 'Payload Too Large',
      });
    }

    const hasBody = contentLength > 0 || req.headers['transfer-encoding'] !== undefined;
    if (!hasBody || METHODS_WITHOUT_BODY.has(req.method)) {
      return next();
    }

    const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const isAllowed = ALLOWED_CONTENT_TYPES.some((allowed) => contentType === allowed);

    if (!isAllowed) {
      throw new UnsupportedMediaTypeException({
        statusCode: 415,
        message: contentType
          ? `Content-Type '${contentType}' is not supported`
          : 'Content-Type header is required for requests with a body',
        error: 'Unsupported Media Type',
      });
    }

    next();
  }
}
