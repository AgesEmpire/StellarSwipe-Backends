import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/** Security headers applied to every API response. */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '0',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cache-Control': 'no-store',
};

/** Headers that must be removed to avoid leaking server internals. */
const HEADERS_TO_REMOVE = ['X-Powered-By', 'Server'];

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    HEADERS_TO_REMOVE.forEach((h) => res.removeHeader(h));
    Object.entries(SECURITY_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    next();
  }
}
