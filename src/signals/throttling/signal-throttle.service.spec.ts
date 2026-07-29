import { Test, TestingModule } from '@nestjs/testing';
import { SignalThrottleService } from './signal-throttle.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { SignalThrottleGuard } from './signal-throttle.guard';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';

describe('SignalThrottle', () => {
  let service: SignalThrottleService;
  let cacheManagerMock: any;
  let guard: SignalThrottleGuard;
  let reflectorMock: any;

  beforeEach(async () => {
    cacheManagerMock = {
      get: jest.fn(),
      set: jest.fn(),
    };

    reflectorMock = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalThrottleService,
        SignalThrottleGuard,
        {
          provide: CACHE_MANAGER,
          useValue: cacheManagerMock,
        },
        {
          provide: 'Reflector',
          useValue: reflectorMock,
        }
      ],
    }).compile();

    service = module.get<SignalThrottleService>(SignalThrottleService);
    guard = new SignalThrottleGuard(service, reflectorMock);
  });

  it('should allow if under limit', async () => {
    cacheManagerMock.get.mockResolvedValue(1);
    const result = await service.checkThrottle('provider1', { limit: 5, ttlSeconds: 60 });
    expect(result).toBe(true);
    expect(cacheManagerMock.set).toHaveBeenCalledWith('signal_throttle:provider1', 2, 60000);
  });

  it('should block if over limit', async () => {
    cacheManagerMock.get.mockResolvedValue(5);
    const result = await service.checkThrottle('provider1', { limit: 5, ttlSeconds: 60 });
    expect(result).toBe(false);
  });

  it('guard should throw 429 when throttled', async () => {
    const mockContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'provider1' } }),
      }),
    } as ExecutionContext;

    cacheManagerMock.get.mockResolvedValue(5);

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      new HttpException('Too Many Requests: Signal creation rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS)
    );
  });
  
  it('guard should throw error when throttled in ws', async () => {
    const mockContext = {
      getType: () => 'ws',
      switchToWs: () => ({
        getClient: () => ({ user: { id: 'provider1' } }),
      }),
    } as ExecutionContext;

    cacheManagerMock.get.mockResolvedValue(5);

    await expect(guard.canActivate(mockContext)).rejects.toThrow('Rate limit exceeded: Too many signals');
  });
});
