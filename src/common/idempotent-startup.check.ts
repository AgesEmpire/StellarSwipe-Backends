import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { IDEMPOTENT_KEY } from './decorators/idempotent.decorator';

/**
 * Startup check to ensure @Idempotent() decorators are only applied to
 * routes that have IdempotencyInterceptor wired through @UseInterceptors().
 *
 * This prevents accidental misuse where @Idempotent() is applied to an endpoint
 * that doesn't actually have idempotency protection enabled.
 */
@Injectable()
export class IdempotentStartupCheck implements OnModuleInit {
  private readonly logger = new Logger(IdempotentStartupCheck.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.validateIdempotentDecorators();
  }

  private validateIdempotentDecorators() {
    const controllers = this.discoveryService.getControllers();

    for (const controller of controllers) {
      const instance = controller.instance;
      if (!instance) continue;

      const prototype = Object.getPrototypeOf(instance);
      const methodNames = this.metadataScanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const method = prototype[methodName];

        // Check if method has @Idempotent() decorator
        const isIdempotent = Reflect.getMetadata(IDEMPOTENT_KEY, method);

        if (!isIdempotent) {
          continue;
        }

        // Check if method has @UseInterceptors() with IdempotencyInterceptor
        const interceptors = Reflect.getMetadata('interceptors:value', method);
        const classInterceptors = Reflect.getMetadata('interceptors:value', controller.metatype);

        const hasIdempotencyInterceptor =
          this.checkInterceptors(interceptors) || this.checkInterceptors(classInterceptors);

        if (!hasIdempotencyInterceptor) {
          const routeName = `${controller.metatype.name}.${methodName}`;
          throw new BadRequestException(
            `Route ${routeName} is marked with @Idempotent() but does not have ` +
            `IdempotencyInterceptor wired through @UseInterceptors(). ` +
            `Add @UseInterceptors(IdempotencyInterceptor) to the controller or method.`,
          );
        }

        this.logger.debug(
          `Validated idempotent route: ${controller.metatype.name}.${methodName}`,
        );
      }
    }

    this.logger.log('Idempotent decorator validation completed successfully');
  }

  private checkInterceptors(interceptors: any[]): boolean {
    if (!Array.isArray(interceptors)) {
      return false;
    }

    return interceptors.some(
      (interceptor) =>
        interceptor.name === 'IdempotencyInterceptor' ||
        (typeof interceptor === 'function' && interceptor.name === 'IdempotencyInterceptor') ||
        (interceptor.constructor && interceptor.constructor.name === 'IdempotencyInterceptor'),
    );
  }
}
