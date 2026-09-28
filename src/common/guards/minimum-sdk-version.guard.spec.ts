import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, BadRequestException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MinimumSdkVersionGuard } from './minimum-sdk-version.guard';
import {
  MinimumSdkVersionConfig,
  MissingHeaderBehavior,
} from '../decorators/minimum-sdk-version.decorator';

describe('MinimumSdkVersionGuard', () => {
  let guard: MinimumSdkVersionGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MinimumSdkVersionGuard, Reflector],
    }).compile();

    guard = module.get<MinimumSdkVersionGuard>(MinimumSdkVersionGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('canActivate', () => {
    let mockContext: ExecutionContext;
    let mockRequest: any;
    let mockResponse: any;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        url: '/test-endpoint',
        socket: { remoteAddress: '127.0.0.1' },
      };
      mockResponse = {
        setHeader: jest.fn(),
      };
      mockContext = {
        getHandler: jest.fn(),
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(mockRequest),
          getResponse: jest.fn().mockReturnValue(mockResponse),
        }),
      } as unknown as ExecutionContext;
    });

    it('should allow request when no decorator is applied', () => {
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);
      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request with valid current SDK version', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.2.3',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);
      mockRequest.headers['x-client-sdk-version'] = '1.2.3';

      expect(guard.canActivate(mockContext)).toBe(true);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-Validated-SDK-Version',
        '1.2.3',
      );
    });

    it('should allow request with newer SDK version', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);
      mockRequest.headers['x-client-sdk-version'] = '2.0.0';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should reject request with outdated SDK version', () => {
      const config: MinimumSdkVersionConfig = {
        version: '2.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);
      mockRequest.headers['x-client-sdk-version'] = '1.5.0';

      expect(() => guard.canActivate(mockContext)).toThrow(HttpException);
    });

    it('should reject request with missing header when behavior is REJECT', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);

      expect(() => guard.canActivate(mockContext)).toThrow(BadRequestException);
    });

    it('should warn but allow request with missing header when behavior is WARN', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.WARN,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow request with missing header when behavior is ALLOW', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.ALLOW,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should reject request with invalid version format', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);
      mockRequest.headers['x-client-sdk-version'] = 'invalid-version';

      expect(() => guard.canActivate(mockContext)).toThrow(BadRequestException);
    });

    it('should accept version with prerelease suffix', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);
      mockRequest.headers['x-client-sdk-version'] = '1.0.1-beta.1';

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should use custom header name from config', () => {
      const config: MinimumSdkVersionConfig = {
        version: '1.0.0',
        missingHeaderBehavior: MissingHeaderBehavior.REJECT,
        headerName: 'X-SDK-Version',
      };
      jest.spyOn(reflector, 'get').mockReturnValue(config);
      mockRequest.headers['x-sdk-version'] = '1.0.0';

      expect(guard.canActivate(mockContext)).toBe(true);
    });
  });
});
