import { registerAs } from '@nestjs/config';

export interface CspDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'connect-src': string[];
  'font-src': string[];
  'object-src': string[];
  'media-src': string[];
  'frame-ancestors': string[];
  'base-uri': string[];
  'form-action': string[];
  'report-uri'?: string[];
}

export const cspConfig = registerAs('csp', () => ({
  enabled: process.env.CSP_ENABLED !== 'false',
  reportOnly: process.env.CSP_REPORT_ONLY === 'true',
  directives: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'nonce-{random}'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'connect-src': [
      "'self'",
      process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
      process.env.STELLAR_SOROBAN_RPC_URL ||
        'https://soroban-testnet.stellar.org',
    ],
    'font-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'media-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'report-uri': ['/api/v1/csp-report'],
  } as CspDirectives,
  additionalHeaders: {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  },
}));
