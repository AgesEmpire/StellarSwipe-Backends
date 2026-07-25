import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AdminIpAllowlistGuard } from './admin-ip-allowlist.guard';

describe('AdminIpAllowlistGuard', () => {
  let guard: AdminIpAllowlistGuard;
  let reflector: Reflector;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminIpAllowlistGuard,
        Reflector,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'NODE_ENV') return 'production';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<AdminIpAllowlistGuard>(AdminIpAllowlistGuard);
    reflector = module.get<Reflector>(Reflector);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('canActivate', () => {
    let mockContext: ExecutionContext;
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        url: '/admin/test',
        method: 'GET',
        socket: { remoteAddress: '127.0.0.1' },
      };
      mockContext = {
        getHandler: jest.fn(),
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
        }),
      } as unknown as ExecutionContext;
    });

    it('should allow request when no decorator is applied', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);
      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request from localhost in production', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '127.0.0.1';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request from private IP range 10.0.0.0/8', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '10.5.10.20';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request from private IP range 172.16.0.0/12', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '172.20.5.10';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request from private IP range 192.168.0.0/16', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '192.168.1.100';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should reject request from public IP in production', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '8.8.8.8';

      expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('should extract IP from x-forwarded-for header', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-forwarded-for'] = '10.0.0.5, 8.8.8.8';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should extract IP from x-real-ip header', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '192.168.0.1';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request when guard is disabled', () => {
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: false });
      mockRequest.headers['x-real-ip'] = '8.8.8.8';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow all requests in development environment', () => {
      // Recreate guard with development environment
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      const devGuard = new AdminIpAllowlistGuard(reflector, configService);
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '8.8.8.8';

      expect(devGuard.canActivate(mockContext)).toBe(true);
    });

    it('should respect custom ADMIN_IP_ALLOWLIST from config', () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_IP_ALLOWLIST') return '1.2.3.4, 5.6.7.8';
        return undefined;
      });

      const customGuard = new AdminIpAllowlistGuard(reflector, configService);
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '1.2.3.4';

      expect(customGuard.canActivate(mockContext)).toBe(true);
    });

    it('should reject custom allowlist when IP not in list', () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_IP_ALLOWLIST') return '1.2.3.4';
        return undefined;
      });

      const customGuard = new AdminIpAllowlistGuard(reflector, configService);
      jest.spyOn(reflector, 'get').mockReturnValue({ enabled: true });
      mockRequest.headers['x-real-ip'] = '8.8.8.8';

      expect(() => customGuard.canActivate(mockContext)).toThrow(ForbiddenException);
    });
  });
});
