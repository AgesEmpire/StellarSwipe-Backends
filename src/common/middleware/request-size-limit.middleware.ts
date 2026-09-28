import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  PayloadTooLargeException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Configuration for request size limits.
 *
 * All values are expressed in bytes unless noted otherwise. They can be
 * overridden via environment variables so deployments can tune the limits
 * without a code change.
 */
export interface RequestSizeLimitOptions {
  /** Maximum size of a JSON / urlencoded request body in bytes. */
  maxBodySize: number;
  /** Maximum size of a multipart upload in bytes. */
  maxMultipartSize: number;
  /** Maximum length of the raw query string in bytes. */
  maxQueryStringSize: number;
  /** Maximum size of a single header value in bytes. */
  maxHeaderSize: number;
  /** Maximum number of headers allowed on a request. */
  maxHeaderCount: number;
  /** Maximum length of a single route parameter value in bytes. */
  maxParamSize: number;
}

const DEFAULT_LIMITS: RequestSizeLimitOptions = {
  maxBodySize: 1 * 1024 * 1024, // 1 MB
  maxMultipartSize: 10 * 1024 * 1024, // 10 MB
  maxQueryStringSize: 8 * 1024, // 8 KB
  maxHeaderSize: 8 * 1024, // 8 KB
  maxHeaderCount: 100,
  maxParamSize: 1024, // 1 KB
};

function readLimit(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Resolves the effective limits from environment variables, falling back to
 * the documented defaults. Exposed for tests and for wiring into the module.
 */
export function resolveRequestSizeLimits(
  overrides: Partial<RequestSizeLimitOptions> = {},
): RequestSizeLimitOptions {
  return {
    maxBodySize: overrides.maxBodySize ?? readLimit('REQUEST_MAX_BODY_SIZE', DEFAULT_LIMITS.maxBodySize),
    maxMultipartSize:
      overrides.maxMultipartSize ?? readLimit('REQUEST_MAX_MULTIPART_SIZE', DEFAULT_LIMITS.maxMultipartSize),
    maxQueryStringSize:
      overrides.maxQueryStringSize ?? readLimit('REQUEST_MAX_QUERY_STRING_SIZE', DEFAULT_LIMITS.maxQueryStringSize),
    maxHeaderSize: overrides.maxHeaderSize ?? readLimit('REQUEST_MAX_HEADER_SIZE', DEFAULT_LIMITS.maxHeaderSize),
    maxHeaderCount: overrides.maxHeaderCount ?? readLimit('REQUEST_MAX_HEADER_COUNT', DEFAULT_LIMITS.maxHeaderCount),
    maxParamSize: overrides.maxParamSize ?? readLimit('REQUEST_MAX_PARAM_SIZE', DEFAULT_LIMITS.maxParamSize),
  };
}

/**
 * Enforces explicit size limits for JSON bodies, multipart uploads, query
 * strings, headers and route parameters. Oversized requests are rejected with
 * stable, documented errors before any expensive downstream processing runs.
 */
@Injectable()
export class RequestSizeLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestSizeLimitMiddleware.name);
  private readonly limits: RequestSizeLimitOptions;

  constructor(limits: Partial<RequestSizeLimitOptions> = {}) {
    this.limits = resolveRequestSizeLimits(limits);
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    this.enforceHeaderLimits(req);
    this.enforceQueryStringLimit(req);
    this.enforceParamLimits(req);
    this.enforceBodyLimit(req);
    next();
  }

  private enforceHeaderLimits(req: Request): void {
    const rawHeaders = req.rawHeaders ?? [];
    const headerCount = rawHeaders.length / 2;
    if (headerCount > this.limits.maxHeaderCount) {
      throw this.tooLarge(
        'HEADER_COUNT_EXCEEDED',
        `Request contains too many headers (max ${this.limits.maxHeaderCount}).`,
      );
    }

    for (let i = 0; i < rawHeaders.length; i += 2) {
      const name = rawHeaders[i];
      const value = rawHeaders[i + 1] ?? '';
      const size = Buffer.byteLength(`${name}: ${value}`, 'utf8');
      if (size > this.limits.maxHeaderSize) {
        throw this.tooLarge(
          'HEADER_SIZE_EXCEEDED',
          `Header "${name}" exceeds the maximum allowed size of ${this.limits.maxHeaderSize} bytes.`,
        );
      }
    }
  }

  private enforceQueryStringLimit(req: Request): void {
    const queryIndex = req.originalUrl ? req.originalUrl.indexOf('?') : -1;
    if (queryIndex === -1) {
      return;
    }
    const queryString = req.originalUrl.slice(queryIndex + 1);
    const size = Buffer.byteLength(queryString, 'utf8');
    if (size > this.limits.maxQueryStringSize) {
      throw this.tooLarge(
        'QUERY_STRING_SIZE_EXCEEDED',
        `Query string exceeds the maximum allowed size of ${this.limits.maxQueryStringSize} bytes.`,
      );
    }
  }

  private enforceParamLimits(req: Request): void {
    const params = req.params ?? {};
    for (const key of Object.keys(params)) {
      const value = params[key];
      if (typeof value !== 'string') {
        continue;
      }
      const size = Buffer.byteLength(value, 'utf8');
      if (size > this.limits.maxParamSize) {
        throw this.tooLarge(
          'PARAM_SIZE_EXCEEDED',
          `Route parameter "${key}" exceeds the maximum allowed size of ${this.limits.maxParamSize} bytes.`,
        );
      }
    }
  }

  private enforceBodyLimit(req: Request): void {
    const contentType = (req.headers['content-type'] ?? '').toLowerCase();
    const isMultipart = contentType.startsWith('multipart/form-data');
    const limit = isMultipart ? this.limits.maxMultipartSize : this.limits.maxBodySize;

    const declaredLength = req.headers['content-length'];
    if (declaredLength !== undefined) {
      const length = Number(declaredLength);
      if (Number.isFinite(length) && length > limit) {
        throw this.tooLarge(
          isMultipart ? 'MULTIPART_SIZE_EXCEEDED' : 'BODY_SIZE_EXCEEDED',
          `Request body exceeds the maximum allowed size of ${limit} bytes.`,
        );
      }
    }

    // Guard against chunked / streamed bodies that omit Content-Length by
    // inspecting the buffered body when it is already available.
    const body = (req as Request & { body?: unknown }).body;
    if (body !== undefined && body !== null && typeof body === 'object') {
      const serialized = this.safeSerialize(body);
      if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > limit) {
        throw this.tooLarge(
          isMultipart ? 'MULTIPART_SIZE_EXCEEDED' : 'BODY_SIZE_EXCEEDED',
          `Request body exceeds the maximum allowed size of ${limit} bytes.`,
        );
      }
    }
  }

  private safeSerialize(body: unknown): string | undefined {
    try {
      return JSON.stringify(body);
    } catch {
      return undefined;
    }
  }

  private tooLarge(code: string, message: string): PayloadTooLargeException {
    this.logger.warn(`Rejected request: ${code} - ${message}`);
    return new PayloadTooLargeException({
      statusCode: 413,
      error: 'Payload Too Large',
      code,
      message,
    });
  }
}

/**
 * Convenience helper for validating a value against a configured limit and
 * throwing a stable BadRequestException when it is exceeded. Useful for
 * callers that need to enforce limits outside the middleware pipeline.
 */
export function assertWithinLimit(
  value: string | undefined,
  limit: number,
  code: string,
  label: string,
): void {
  if (value === undefined) {
    return;
  }
  if (Buffer.byteLength(value, 'utf8') > limit) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code,
      message: `${label} exceeds the maximum allowed size of ${limit} bytes.`,
    });
  }
}
