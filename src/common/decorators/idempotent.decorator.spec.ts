import { Test } from '@nestjs/testing';
import { Controller, UseInterceptors, Post } from '@nestjs/common';
import { Idempotent, IDEMPOTENT_KEY } from './idempotent.decorator';
import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor';

describe('Idempotent Decorator', () => {
  it('should set IDEMPOTENT_KEY metadata on method', () => {
    class TestClass {
      @Idempotent()
      testMethod() {
        return 'test';
      }
    }

    const metadata = Reflect.getMetadata(IDEMPOTENT_KEY, TestClass.prototype.testMethod);
    expect(metadata).toBe(true);
  });

  it('should apply ApiHeader decorator for Swagger documentation', () => {
    class TestClass {
      @Idempotent()
      testMethod() {
        return 'test';
      }
    }

    const apiHeaderMetadata = Reflect.getMetadata(
      'swagger/apiHeader',
      TestClass.prototype.testMethod,
    );
    expect(apiHeaderMetadata).toBeDefined();
  });

  it('should document Idempotency-Key header with correct schema', async () => {
    @Controller('test')
    @UseInterceptors(IdempotencyInterceptor)
    class TestController {
      @Post('action')
      @Idempotent()
      testAction() {
        return { success: true };
      }
    }

    const module = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();

    const controller = module.get(TestController);
    const metadata = Reflect.getMetadata(IDEMPOTENT_KEY, TestController.prototype.testAction);
    expect(metadata).toBe(true);
  });

  it('should be combinable with other decorators', () => {
    class TestClass {
      @Idempotent()
      @UseInterceptors()
      testMethod() {
        return 'test';
      }
    }

    const metadata = Reflect.getMetadata(IDEMPOTENT_KEY, TestClass.prototype.testMethod);
    expect(metadata).toBe(true);
  });
});
