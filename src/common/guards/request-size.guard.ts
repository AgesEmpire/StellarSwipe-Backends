import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const REQUEST_SIZE_LIMIT_KEY = Symbol('REQUEST_SIZE_LIMIT');

export interface RequestSizeLimitConfig {
  maxBodySize?: number; // in bytes
  maxParamSize?: number; // in bytes
}

@Injectable()
export class RequestSizeGuard implements CanActivate {
  private readonly logger = new Logger(RequestSizeGuard.name);

  // Default limits
  private readonly defaultLimits = {
    maxBodySize: 10 * 1024 * 1024, // 10MB
    maxParamSize: 2048, // 2KB
    maxHeaderSize: 16 * 1024, // 16KB
  };

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const limits = this.reflector.get<RequestSizeLimitConfig>(
      REQUEST_SIZE_LIMIT_KEY,
      context.getHandler(),
    ) || {};

    const maxBodySize = limits.maxBodySize || this.defaultLimits.maxBodySize;
    const maxParamSize = limits.maxParamSize || this.defaultLimits.maxParamSize;
    const maxHeaderSize = this.defaultLimits.maxHeaderSize;

    const request = context.switchToHttp().getRequest();

    // Check request body size
    if (request.get('content-length')) {
      const contentLength = parseInt(request.get('content-length'), 10);
      if (contentLength > maxBodySize) {
        this.logger.warn(
          `Request body size (${contentLength} bytes) exceeds limit (${maxBodySize} bytes)`,
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
            message: `Request body size (${contentLength} bytes) exceeds maximum limit (${maxBodySize} bytes)`,
            error: 'Payload Too Large',
          },
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
    }

    // Check query parameters size
    const queryString = request.url.split('?')[1] || '';
    if (queryString.length > maxParamSize) {
      this.logger.warn(
        `Query parameters size (${queryString.length} bytes) exceeds limit (${maxParamSize} bytes)`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
          message: `Query parameters size (${queryString.length} bytes) exceeds maximum limit (${maxParamSize} bytes)`,
          error: 'Request Header Fields Too Large',
        },
        HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
      );
    }

    // Check headers size (combined)
    let headerSize = 0;
    const headers = request.headers;
    Object.values(headers).forEach((value: any) => {
      headerSize += (typeof value === 'string' ? value : String(value)).length;
    });

    if (headerSize > maxHeaderSize) {
      this.logger.warn(
        `Request headers size (${headerSize} bytes) exceeds limit (${maxHeaderSize} bytes)`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
          message: `Request headers size (${headerSize} bytes) exceeds maximum limit (${maxHeaderSize} bytes)`,
          error: 'Request Header Fields Too Large',
        },
        HttpStatus.REQUEST_HEADER_FIELDS_TOO_LARGE,
      );
    }

    return true;
  }
}
