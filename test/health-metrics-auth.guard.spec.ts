import { ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { HealthMetricsAuthGuard } from '../src/common/guards/health-metrics-auth.guard';
import { ApiKeyAuthGuard } from '../src/api-keys/guards/api-key-auth.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('HealthMetricsAuthGuard', () => {
  let guard: HealthMetricsAuthGuard;
  let jwtGuard: Partial<JwtAuthGuard>;
  let apiKeyGuard: Partial<ApiKeyAuthGuard>;
  const context = {
    switchToHttp: jest.fn().mockReturnValue({ getRequest: jest.fn(), getResponse: jest.fn() }),
    getClass: jest.fn(),
    getHandler: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jwtGuard = { canActivate: jest.fn() };
    apiKeyGuard = { canActivate: jest.fn() };
    guard = new HealthMetricsAuthGuard(
      jwtGuard as JwtAuthGuard,
      apiKeyGuard as ApiKeyAuthGuard,
    );
  });

  it('permits access when JwtAuthGuard succeeds', async () => {
    (jwtGuard.canActivate as jest.Mock).mockResolvedValue(true);
    (apiKeyGuard.canActivate as jest.Mock).mockResolvedValue(false);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('permits access when ApiKeyAuthGuard succeeds after JwtAuthGuard fails', async () => {
    (jwtGuard.canActivate as jest.Mock).mockRejectedValue(new UnauthorizedException());
    (apiKeyGuard.canActivate as jest.Mock).mockResolvedValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1);
  });

  it('rejects with UnauthorizedException when both guards fail with unauthorized', async () => {
    (jwtGuard.canActivate as jest.Mock).mockRejectedValue(new UnauthorizedException());
    (apiKeyGuard.canActivate as jest.Mock).mockRejectedValue(new UnauthorizedException());

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(jwtGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1);
  });

  it('propagates ForbiddenException from ApiKeyAuthGuard when JWT fails', async () => {
    (jwtGuard.canActivate as jest.Mock).mockRejectedValue(new UnauthorizedException());
    (apiKeyGuard.canActivate as jest.Mock).mockRejectedValue(new ForbiddenException());

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(jwtGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(apiKeyGuard.canActivate).toHaveBeenCalledTimes(1);
  });
});
