import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RotationService } from './rotation.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [RotationService],
  exports: [RotationService],
})
export class SecretsModule {}
