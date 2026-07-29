import { VersionCompatibilityGuard } from './version-compatibility.guard';
import { VersionManagerService } from '../version-manager.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, GoneException } from '@nestjs/common';

describe('VersionCompatibilityGuard', () => {
  let guard: VersionCompatibilityGuard;
  let versionManager: jest.Mocked<VersionManagerService>;
  let reflector: jest.Mocked<Reflector>;
  let mockContext: ExecutionContext;
  let mockRequest: any;
  let mockResponse: any;

  beforeEach(() => {
    versionManager = {
      isSupported: jest.fn(),
      isDeprecated: jest.fn(),
      getDefaultVersion: jest.fn().mockReturnValue('2'),
      getVersionMetadata: jest.fn(),
    } as any;

    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    guard = new VersionCompatibilityGuard(reflector, versionManager);

    mockRequest = {};
    mockResponse = {
      setHeader: jest.fn(),
    };

    mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  });

  it('should pass for supported version', () => {
    mockRequest.apiVersion = '2';
    versionManager.isSupported.mockReturnValue(true);
    versionManager.isDeprecated.mockReturnValue(false);

    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('should throw GoneException for unsupported version', () => {
    mockRequest.apiVersion = '0';
    versionManager.isSupported.mockReturnValue(false);

    expect(() => guard.canActivate(mockContext)).toThrow(GoneException);
  });

  it('should set deprecation headers for deprecated version', () => {
    mockRequest.apiVersion = '1';
    versionManager.isSupported.mockReturnValue(true);
    versionManager.isDeprecated.mockReturnValue(true);
    versionManager.getVersionMetadata.mockReturnValue({
      status: 'deprecated' as any,
      sunsetDate: '2025-12-31',
      successorVersion: '2',
    });

    expect(guard.canActivate(mockContext)).toBe(true);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Sunset', '2025-12-31');
    expect(mockResponse.setHeader).toHaveBeenCalledWith('Link', '</api/v2>; rel="successor-version"');
  });
});
