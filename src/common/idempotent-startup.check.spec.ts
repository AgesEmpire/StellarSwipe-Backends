import { Test } from '@nestjs/testing';
import { Controller, UseInterceptors, Post, BadRequestException } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { IdempotentStartupCheck } from './idempotent-startup.check';
import { Idempotent } from './decorators/idempotent.decorator';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';

describe('IdempotentStartupCheck', () => {
  let service: IdempotentStartupCheck;
  let discoveryService: DiscoveryService;
  let metadataScanner: MetadataScanner;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [IdempotentStartupCheck, DiscoveryService, MetadataScanner],
    }).compile();

    service = module.get<IdempotentStartupCheck>(IdempotentStartupCheck);
    discoveryService = module.get<DiscoveryService>(DiscoveryService);
    metadataScanner = module.get<MetadataScanner>(MetadataScanner);
  });

  describe('validateIdempotentDecorators', () => {
    it('should pass validation when @Idempotent() has @UseInterceptors(IdempotencyInterceptor) on method', () => {
      @Controller('test')
      class TestController {
        @Post('action')
        @Idempotent()
        @UseInterceptors(IdempotencyInterceptor)
        testAction() {
          return { success: true };
        }
      }

      jest
        .spyOn(discoveryService, 'getControllers')
        .mockReturnValue([
          {
            instance: new TestController(),
            metatype: TestController,
            isDynamic: false,
            scope: 'DEFAULT' as any,
            durationMs: 0,
          },
        ] as any);

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should pass validation when @Idempotent() has @UseInterceptors(IdempotencyInterceptor) on class', () => {
      @Controller('test')
      @UseInterceptors(IdempotencyInterceptor)
      class TestController {
        @Post('action')
        @Idempotent()
        testAction() {
          return { success: true };
        }
      }

      jest
        .spyOn(discoveryService, 'getControllers')
        .mockReturnValue([
          {
            instance: new TestController(),
            metatype: TestController,
            isDynamic: false,
            scope: 'DEFAULT' as any,
            durationMs: 0,
          },
        ] as any);

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should throw error when @Idempotent() missing @UseInterceptors(IdempotencyInterceptor)', () => {
      @Controller('test')
      class TestControllerWithoutInterceptor {
        @Post('action')
        @Idempotent()
        testAction() {
          return { success: true };
        }
      }

      jest
        .spyOn(discoveryService, 'getControllers')
        .mockReturnValue([
          {
            instance: new TestControllerWithoutInterceptor(),
            metatype: TestControllerWithoutInterceptor,
            isDynamic: false,
            scope: 'DEFAULT' as any,
            durationMs: 0,
          },
        ] as any);

      expect(() => service.onModuleInit()).toThrow(BadRequestException);
    });

    it('should not validate routes without @Idempotent()', () => {
      @Controller('test')
      class TestController {
        @Post('action')
        testAction() {
          return { success: true };
        }
      }

      jest
        .spyOn(discoveryService, 'getControllers')
        .mockReturnValue([
          {
            instance: new TestController(),
            metatype: TestController,
            isDynamic: false,
            scope: 'DEFAULT' as any,
            durationMs: 0,
          },
        ] as any);

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should handle controllers with no instance gracefully', () => {
      jest
        .spyOn(discoveryService, 'getControllers')
        .mockReturnValue([
          {
            instance: null,
            metatype: class TestController {},
            isDynamic: false,
            scope: 'DEFAULT' as any,
            durationMs: 0,
          },
        ] as any);

      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should validate multiple methods in a controller', () => {
      @Controller('test')
      @UseInterceptors(IdempotencyInterceptor)
      class TestController {
        @Post('action1')
        @Idempotent()
        testAction1() {
          return { success: true };
        }

        @Post('action2')
        @Idempotent()
        testAction2() {
          return { success: true };
        }

        @Post('action3')
        regularAction() {
          return { success: true };
        }
      }

      jest
        .spyOn(discoveryService, 'getControllers')
        .mockReturnValue([
          {
            instance: new TestController(),
            metatype: TestController,
            isDynamic: false,
            scope: 'DEFAULT' as any,
            durationMs: 0,
          },
        ] as any);

      expect(() => service.onModuleInit()).not.toThrow();
    });
  });
});
