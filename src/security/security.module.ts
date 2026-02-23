import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CspMiddleware } from './csp/csp.middleware';
import { CspReporterController } from './csp/csp-reporter.controller';
import { cspConfig } from './config/csp.config';

@Module({
  imports: [ConfigModule.forFeature(cspConfig)],
  controllers: [CspReporterController],
  providers: [CspMiddleware],
  exports: [CspMiddleware],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CspMiddleware).forRoutes('*');
  }
}
