import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MaxCallDepthGuard } from './max-call-depth.guard';
import { MaxCallDepthConfig } from '../decorators/max-call-depth.decorator';

const mockReflector = {
  get: jest.fn(),
};

function buildContext(
  actualCallDepth?: number,
): ExecutionContext {
  const response = { setHeader: jest.fn() };
  const request: {
    actualCallDepth?: number;
    _maxCallDepthConfig?: MaxCallDepthConfig | undefined;
  } = {
    actualCallDepth,
  };
  return {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('MaxCallDepthGuard', () => {
  let guard: MaxCallDepthGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaxCallDepthGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get(MaxCallDepthGuard);
  });

  it('allows request when no decorator is applied', () => {
    mockReflector.get.mockReturnValue(undefined);

    const ctx = buildContext(5);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows request when call depth not yet computed', () => {
    mockReflector.get.mockReturnValue({ maxDepth: 5 });

    const ctx = buildContext(undefined);
    expect(guard.canActivate(ctx)).toBe(true);
    const request = ctx.switchToHttp().getRequest();
    expect(request._maxCallDepthConfig).toEqual({ maxDepth: 5 });
  });

  it('allows request when depth is within limit', () => {
    mockReflector.get.mockReturnValue({ maxDepth: 10, endpoint: 'test' });

    const ctx = buildContext(3);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ConflictException when depth exceeds max and onViolation is reject', () => {
    const config: MaxCallDepthConfig = { maxDepth: 5, endpoint: 'test', onViolation: 'reject' };
    mockReflector.get.mockReturnValue(config);

    const ctx = buildContext(7);
    expect(() => guard.canActivate(ctx)).toThrow(ConflictException);
  });

  it('throws ConflictException when depth exceeds max with default onViolation', () => {
    mockReflector.get.mockReturnValue({ maxDepth: 3 });

    const ctx = buildContext(5);
    expect(() => guard.canActivate(ctx)).toThrow(ConflictException);
  });

  it('logs warning but allows in warn mode', () => {
    const config: MaxCallDepthConfig = { maxDepth: 3, endpoint: 'test', onViolation: 'warn' };
    mockReflector.get.mockReturnValue(config);

    const ctx = buildContext(6);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('handles null actualCallDepth gracefully', () => {
    mockReflector.get.mockReturnValue({ maxDepth: 5 });

    const ctx = buildContext(null as unknown as number);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows request when actualCallDepth is 0', () => {
    mockReflector.get.mockReturnValue({ maxDepth: 5 });

    const ctx = buildContext(0);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});