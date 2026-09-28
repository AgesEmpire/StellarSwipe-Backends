import { MaxBodySizeGuard } from './max-body-size.guard';
import { PayloadTooLargeException } from '@nestjs/common';

const makeContext = (contentLength: number | null) => ({
  getHandler: () => ({}),
  switchToHttp: () => ({
    getRequest: () => ({
      headers: contentLength !== null ? { 'content-length': String(contentLength) } : {},
    }),
  }),
});

const makeGuard = (limit: number | undefined) => {
  const reflector = { get: jest.fn().mockReturnValue(limit) } as any;
  return new MaxBodySizeGuard(reflector);
};

describe('MaxBodySizeGuard', () => {
  it('allows request below the limit', () => {
    expect(makeGuard(1024).canActivate(makeContext(512) as any)).toBe(true);
  });

  it('allows request at the limit', () => {
    expect(makeGuard(1024).canActivate(makeContext(1024) as any)).toBe(true);
  });

  it('throws PayloadTooLargeException when above the limit', () => {
    expect(() => makeGuard(1024).canActivate(makeContext(2048) as any)).toThrow(
      PayloadTooLargeException,
    );
  });

  it('passes when no limit metadata is set', () => {
    expect(makeGuard(undefined).canActivate(makeContext(99999) as any)).toBe(true);
  });
});
