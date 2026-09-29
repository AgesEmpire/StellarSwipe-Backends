import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  AdminIpAllowlistGuard,
  isIpInRange,
  parseIpAddress,
  parseIpRange,
  ParsedIpRange,
} from './admin-ip-allowlist.guard';

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

  describe('IP range matching', () => {
    const matches = (ip: string, range: string): boolean => {
      const parsedIp = parseIpAddress(ip);
      const parsedRange = parseIpRange(range);
      if (!parsedIp || 'reason' in parsedRange) return false;
      return isIpInRange(parsedIp, parsedRange as ParsedIpRange);
    };

    it('retains IPv4 CIDR boundary behaviour', () => {
      expect(matches('172.16.0.0', '172.16.0.0/12')).toBe(true);
      expect(matches('172.31.255.255', '172.16.0.0/12')).toBe(true);
      expect(matches('172.32.0.0', '172.16.0.0/12')).toBe(false);
      expect(matches('8.8.8.8', '0.0.0.0/0')).toBe(true);
      expect(matches('10.0.0.1', '10.0.0.1/32')).toBe(true);
      expect(matches('10.0.0.2', '10.0.0.1/32')).toBe(false);
    });

    it('matches IPv6 single addresses', () => {
      expect(matches('::1', '::1')).toBe(true);
      expect(matches('0:0:0:0:0:0:0:1', '::1')).toBe(true);
      expect(matches('::2', '::1')).toBe(false);
    });

    it('matches IPv6 CIDR boundaries', () => {
      expect(matches('2001:db8::', '2001:db8::/32')).toBe(true);
      expect(matches('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db8::/32')).toBe(true);
      expect(matches('2001:db9::', '2001:db8::/32')).toBe(false);
      expect(matches('2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db8::/32')).toBe(false);
      expect(matches('fd12:3456::1', 'fc00::/7')).toBe(true);
      expect(matches('fe00::1', 'fc00::/7')).toBe(false);
      expect(matches('2001:db8::1', '2001:db8::1/128')).toBe(true);
      expect(matches('2001:db8::2', '2001:db8::1/128')).toBe(false);
      expect(matches('abcd::1', '::/0')).toBe(true);
    });

    it('does not match across address families', () => {
      expect(matches('10.0.0.1', '::/0')).toBe(false);
      expect(matches('::1', '0.0.0.0/0')).toBe(false);
    });

    it('treats IPv4-mapped IPv6 addresses as IPv4', () => {
      expect(matches('::ffff:10.1.2.3', '10.0.0.0/8')).toBe(true);
      expect(matches('::ffff:10.1.2.3', '::ffff:10.0.0.0/104')).toBe(true);
      expect(matches('::ffff:11.1.2.3', '10.0.0.0/8')).toBe(false);
    });

    it.each([
      ['10.0.0.0/33', 'prefix length out of range for IPv4'],
      ['2001:db8::/129', 'prefix length out of range for IPv6'],
      ['2001:db8::/abc', 'invalid prefix length'],
      ['10.0.0.0/', 'invalid prefix length'],
      ['10.0.0.0/8/8', 'multiple prefix separators'],
      ['2001:db8:::1/64', 'invalid IP address'],
      ['256.0.0.0/8', 'invalid IP address'],
    ])('rejects malformed range %s with a reason', (range, reason) => {
      expect(parseIpRange(range)).toEqual({ reason });
    });
  });

  describe('IPv6 allowlist configuration', () => {
    const buildGuard = (allowlist: string) =>
      new AdminIpAllowlistGuard(new Reflector(), {
        get: (key: string) =>
          key === 'NODE_ENV' ? 'production' : key === 'ADMIN_IP_ALLOWLIST' ? allowlist : undefined,
      } as unknown as ConfigService);

    const contextFor = (ip: string) =>
      ({
        getHandler: jest.fn(),
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-real-ip': ip }, url: '/admin', method: 'GET' }),
        }),
      }) as unknown as ExecutionContext;

    beforeEach(() => {
      jest.spyOn(Reflector.prototype, 'get').mockReturnValue({ enabled: true });
    });

    afterEach(() => jest.restoreAllMocks());

    it('allows IPv6 clients within a configured CIDR range', () => {
      const g = buildGuard('2001:db8:abcd::/48');
      expect(g.canActivate(contextFor('2001:db8:abcd:12::5'))).toBe(true);
      expect(() => g.canActivate(contextFor('2001:db8:abce::5'))).toThrow(ForbiddenException);
    });

    it('fails closed and logs malformed entries', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const g = buildGuard('not-an-ip/64, 2001:db8::/200');
      expect(() => g.canActivate(contextFor('2001:db8::1'))).toThrow(ForbiddenException);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('2001:db8::/200'),
        expect.objectContaining({
          type: 'admin_ip_allowlist_invalid_range',
          reason: 'prefix length out of range for IPv6',
        }),
      );
    });
  });
});
