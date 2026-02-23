import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CspMiddleware } from '../csp.middleware';
import { Request, Response } from 'express';

describe('CspMiddleware', () => {
  let middleware: CspMiddleware;
  let configService: ConfigService;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CspMiddleware,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                'csp.enabled': true,
                'csp.reportOnly': false,
                'csp.directives': {
                  'default-src': ["'self'"],
                  'script-src': ["'self'", "'nonce-{random}'"],
                  'style-src': ["'self'", "'unsafe-inline'"],
                  'img-src': ["'self'", 'data:', 'https:'],
                  'connect-src': ["'self'"],
                  'frame-ancestors': ["'none'"],
                  'report-uri': ['/api/v1/csp-report'],
                },
                'csp.additionalHeaders': {
                  'X-Frame-Options': 'DENY',
                  'X-Content-Type-Options': 'nosniff',
                },
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    middleware = module.get<CspMiddleware>(CspMiddleware);
    configService = module.get<ConfigService>(ConfigService);

    mockRequest = {};
    mockResponse = {
      setHeader: jest.fn(),
    };
    nextFunction = jest.fn();
  });

  it('should be defined', () => {
    expect(middleware).toBeDefined();
  });

  it('should set CSP header with nonce', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("script-src 'self' 'nonce-"),
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should generate unique nonce per request', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );
    const nonce1 = (mockRequest as any).cspNonce;

    const mockRequest2 = {};
    middleware.use(
      mockRequest2 as Request,
      mockResponse as Response,
      nextFunction,
    );
    const nonce2 = (mockRequest2 as any).cspNonce;

    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toBe(nonce2);
  });

  it('should set additional security headers', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'X-Frame-Options',
      'DENY',
    );
    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
  });

  it('should use report-only header when configured', () => {
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'csp.reportOnly') return true;
      if (key === 'csp.enabled') return true;
      if (key === 'csp.directives')
        return { 'default-src': ["'self'"], 'report-uri': ['/api/csp-report'] };
      if (key === 'csp.additionalHeaders') return {};
      return undefined;
    });

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy-Report-Only',
      expect.any(String),
    );
  });

  it('should skip when CSP is disabled', () => {
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === 'csp.enabled') return false;
      return undefined;
    });

    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect(mockResponse.setHeader).not.toHaveBeenCalled();
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should attach nonce to request object', () => {
    middleware.use(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction,
    );

    expect((mockRequest as any).cspNonce).toBeDefined();
    expect(typeof (mockRequest as any).cspNonce).toBe('string');
    expect((mockRequest as any).cspNonce.length).toBeGreaterThan(0);
  });
});
