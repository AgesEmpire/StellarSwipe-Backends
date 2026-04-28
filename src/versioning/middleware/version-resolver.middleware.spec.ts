import { NotFoundException } from '@nestjs/common';
import { VersionResolverMiddleware } from './version-resolver.middleware';
import { VersionManagerService } from '../version-manager.service';
import { VersionStatus } from '../interfaces/version-config.interface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    _headers: headers,
  };
}

function buildMockReq(path: string, headerVersion?: string) {
  return {
    path,
    headers: headerVersion ? { 'api-version': headerVersion } : {},
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VersionResolverMiddleware', () => {
  let middleware: VersionResolverMiddleware;
  let versionManager: VersionManagerService;

  beforeEach(async () => {
    versionManager = new VersionManagerService();
    middleware = new VersionResolverMiddleware(versionManager);
  });

  it('resolves version from URL path', () => {
    const req = buildMockReq('/api/v2/signals');
    const res = buildMockRes();
    const next = jest.fn();

    middleware.use(req, res as any, next);

    expect(req['apiVersion']).toBe('2');
    expect(next).toHaveBeenCalled();
  });

  it('resolves version from api-version header when no URL version', () => {
    const req = buildMockReq('/api/signals', '2');
    const res = buildMockRes();
    const next = jest.fn();

    middleware.use(req, res as any, next);

    expect(req['apiVersion']).toBe('2');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to default version when no version info present', () => {
    const req = buildMockReq('/health');
    const res = buildMockRes();
    const next = jest.fn();

    middleware.use(req, res as any, next);

    expect(req['apiVersion']).toBe(versionManager.getDefaultVersion());
    expect(next).toHaveBeenCalled();
  });

  it('throws NotFoundException for unsupported version', () => {
    const req = buildMockReq('/api/v99/signals');
    const res = buildMockRes();
    const next = jest.fn();

    expect(() => middleware.use(req, res as any, next)).toThrow(NotFoundException);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets Deprecation headers for deprecated version (v1)', () => {
    const req = buildMockReq('/api/v1/signals');
    const res = buildMockRes();
    const next = jest.fn();

    middleware.use(req, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    expect(res.setHeader).toHaveBeenCalledWith('Sunset', '2025-12-31');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Link',
      '</api/v2>; rel="successor-version"',
    );
    expect(next).toHaveBeenCalled();
  });

  it('does NOT set Deprecation headers for current version (v2)', () => {
    const req = buildMockReq('/api/v2/signals');
    const res = buildMockRes();
    const next = jest.fn();

    middleware.use(req, res as any, next);

    expect(res.setHeader).not.toHaveBeenCalledWith('Deprecation', 'true');
    expect(next).toHaveBeenCalled();
  });

  it('URL version takes precedence over header version', () => {
    const req = buildMockReq('/api/v2/signals', '1');
    const res = buildMockRes();
    const next = jest.fn();

    middleware.use(req, res as any, next);

    expect(req['apiVersion']).toBe('2');
  });

  it('throws NotFoundException for sunset version', () => {
    // Temporarily override isSupported to simulate a sunset version
    jest.spyOn(versionManager, 'isSupported').mockReturnValue(false);
    const req = buildMockReq('/api/v1/signals');
    const res = buildMockRes();
    const next = jest.fn();

    expect(() => middleware.use(req, res as any, next)).toThrow(NotFoundException);
  });
});
