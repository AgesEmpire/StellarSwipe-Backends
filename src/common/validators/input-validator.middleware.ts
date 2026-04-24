import {
  Injectable,
  NestMiddleware,
  Logger,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Maximum accepted body size in bytes (1 MB). Requests larger than this are
 * rejected before any deserialization to prevent memory exhaustion.
 */
const MAX_BODY_BYTES = 1_048_576;

/**
 * Maximum depth of nested objects/arrays in a JSON body. Deeply nested
 * payloads can cause stack overflows during recursive processing.
 */
const MAX_OBJECT_DEPTH = 10;

/**
 * Maximum number of keys allowed at any single level of a JSON object.
 * Limits prototype-pollution surface and CPU spent iterating huge objects.
 */
const MAX_OBJECT_KEYS = 100;

/**
 * Maximum length of any individual string value in the body.
 */
const MAX_STRING_LENGTH = 10_000;

/**
 * Patterns that indicate obvious injection attempts. These are checked
 * on string values in the body, query, and headers to provide an early
 * fail-fast layer on top of ORM-level parameterization.
 */
const INJECTION_PATTERNS = [
  // SQL — only obvious keyword sequences; parameterized queries are the real defence
  /(\b(union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+\w+\s+set|alter\s+table|exec(\s+|\()|xp_cmdshell)\b)/i,
  // NoSQL / MongoDB operator injection
  /\$where|\$gt|\$lt|\$ne|\$regex|\$exists/,
  // Script injection
  /<script[\s>]/i,
  // Path traversal
  /\.\.[/\\]/,
  // Null byte injection
  /\x00/,
  // SSTI - common template delimiters combined with suspicious payloads
  /\{\{.*?\}\}|\{%.*?%\}/,
];

/**
 * Header names that clients must not send (internal-use only).
 */
const FORBIDDEN_REQUEST_HEADERS = [
  'x-internal-user-id',
  'x-internal-role',
  'x-bypass-auth',
  'x-admin',
];

@Injectable()
export class InputValidatorMiddleware implements NestMiddleware {
  private readonly logger = new Logger(InputValidatorMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    try {
      this.rejectForbiddenHeaders(req);
      this.enforceContentLength(req);
      this.validateBody(req);
      this.validateQueryParams(req);
      next();
    } catch (error) {
      // Re-throw NestJS HTTP exceptions directly; wrap anything else
      if (
        error instanceof BadRequestException ||
        error instanceof PayloadTooLargeException
      ) {
        throw error;
      }
      this.logger.error('Unexpected error in InputValidatorMiddleware', error);
      throw new BadRequestException('Malformed request');
    }
  }

  private rejectForbiddenHeaders(req: Request): void {
    for (const header of FORBIDDEN_REQUEST_HEADERS) {
      if (req.headers[header] !== undefined) {
        this.logger.warn(
          `Rejected request with forbidden header "${header}" from ${this.clientIp(req)}`,
        );
        throw new BadRequestException(`Header "${header}" is not permitted`);
      }
    }
  }

  private enforceContentLength(req: Request): void {
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      throw new PayloadTooLargeException(
        `Request body must not exceed ${MAX_BODY_BYTES} bytes`,
      );
    }
  }

  private validateBody(req: Request): void {
    if (!req.body || typeof req.body !== 'object') return;

    const bodyStr = JSON.stringify(req.body);
    if (Buffer.byteLength(bodyStr, 'utf8') > MAX_BODY_BYTES) {
      throw new PayloadTooLargeException(
        `Serialized body exceeds the ${MAX_BODY_BYTES}-byte limit`,
      );
    }

    this.inspectValue(req.body, 0, 'body');
  }

  private validateQueryParams(req: Request): void {
    for (const [key, value] of Object.entries(req.query)) {
      const strVal = Array.isArray(value) ? value.join(',') : String(value ?? '');
      this.checkInjectionPatterns(strVal, `query.${key}`);
    }
  }

  private inspectValue(value: unknown, depth: number, path: string): void {
    if (depth > MAX_OBJECT_DEPTH) {
      this.logger.warn(`Payload exceeded max depth at ${path}`);
      throw new BadRequestException(
        `Request body nesting exceeds the maximum depth of ${MAX_OBJECT_DEPTH}`,
      );
    }

    if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) {
        throw new BadRequestException(
          `Field "${path}" exceeds the maximum string length of ${MAX_STRING_LENGTH}`,
        );
      }
      this.checkInjectionPatterns(value, path);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, i) => this.inspectValue(item, depth + 1, `${path}[${i}]`));
      return;
    }

    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value as Record<string, unknown>);

      if (keys.length > MAX_OBJECT_KEYS) {
        throw new BadRequestException(
          `Object at "${path}" has too many keys (max ${MAX_OBJECT_KEYS})`,
        );
      }

      // Reject prototype-pollution keys
      for (const key of keys) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          this.logger.warn(`Prototype pollution attempt detected at ${path}.${key}`);
          throw new BadRequestException(
            'Prototype pollution keys are not permitted',
          );
        }
        this.inspectValue(
          (value as Record<string, unknown>)[key],
          depth + 1,
          `${path}.${key}`,
        );
      }
    }
  }

  private checkInjectionPatterns(value: string, field: string): void {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        this.logger.warn(
          `Potential injection attempt in field "${field}": pattern ${pattern.source} matched`,
        );
        throw new BadRequestException(
          `Field "${field}" contains disallowed content`,
        );
      }
    }
  }

  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return (forwarded as string).split(',')[0].trim();
    return req.socket?.remoteAddress ?? 'unknown';
  }
}
