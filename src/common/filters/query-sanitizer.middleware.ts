import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * #385 — Query parameter sanitization middleware.
 *
 * Sanitizes all incoming query parameters to prevent injection and ensure predictable request handling.
 * Removes potentially dangerous characters and normalizes parameter values.
 */
@Injectable()
export class QuerySanitizerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(QuerySanitizerMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    try {
      this.sanitizeQueryParameters(req);
      next();
    } catch (error) {
      this.logger.error('Error sanitizing query parameters', error);
      next();
    }
  }

  private sanitizeQueryParameters(req: Request): void {
    const sanitizedQuery: Record<string, any> = {};

    for (const [key, value] of Object.entries(req.query)) {
      // Skip if key is empty or contains dangerous characters
      if (!key || typeof key !== 'string') {
        continue;
      }

      // Sanitize key: remove non-alphanumeric characters except underscore, dash, dot
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_.-]/g, '');

      if (!sanitizedKey) {
        continue;
      }

      // Handle array values
      if (Array.isArray(value)) {
        sanitizedQuery[sanitizedKey] = value.map(v => this.sanitizeValue(v));
      } else {
        sanitizedQuery[sanitizedKey] = this.sanitizeValue(value);
      }
    }

    req.query = sanitizedQuery;
  }

  private sanitizeValue(value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    // Trim whitespace
    let sanitized = value.trim();

    // Remove null bytes and other control characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

    // Basic HTML entity escaping
    sanitized = sanitized
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');

    // Remove potential SQL injection patterns
    sanitized = sanitized.replace(/(\b(union|select|insert|delete|update|drop|create|alter|exec|execute)\b)/gi, '');

    // Remove script tags
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Limit length to prevent buffer overflow attacks
    if (sanitized.length > 1000) {
      sanitized = sanitized.substring(0, 1000);
      this.logger.warn('Query parameter truncated due to length limit');
    }

    return sanitized;
  }
}