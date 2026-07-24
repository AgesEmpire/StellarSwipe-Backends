import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from '@nestjs/config';
import { RotationService } from './rotation.service';
import { SecretsLoaderService } from './secrets-loader.service';
import { SecretRotationScheduler } from './rotation-scheduler.service';

@Module({
  imports: [EventEmitterModule.forRoot(), ConfigModule],
  providers: [RotationService, SecretsLoaderService, SecretRotationScheduler],
  exports: [RotationService, SecretsLoaderService, SecretRotationScheduler],
})
export class SecretsModule {}
