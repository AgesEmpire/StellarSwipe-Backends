import { Module, NestModule, MiddlewareConsumer, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CspMiddleware } from './csp/csp.middleware';
import { CspReporterController } from './csp/csp-reporter.controller';
import { cspConfig } from './config/csp.config';
import { EncryptionService } from './encryption.service';
import { EncryptedColumnTransformer } from './encrypted-column.transformer';

@Module({
  imports: [ConfigModule.forFeature(cspConfig)],
  controllers: [CspReporterController],
  providers: [CspMiddleware, EncryptionService],
  exports: [CspMiddleware, EncryptionService],
})
export class SecurityModule implements NestModule, OnModuleInit {
  constructor(private readonly encryptionService: EncryptionService) {}

  onModuleInit(): void {
    EncryptedColumnTransformer.init(this.encryptionService);
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CspMiddleware).forRoutes('*');
  }
}
