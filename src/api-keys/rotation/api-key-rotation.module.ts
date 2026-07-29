import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiKeyRotationService } from './api-key-rotation.service';
import { RotateApiKeysJob } from './jobs/rotate-api-keys.job';
import { ApiKey } from '../entities/api-key.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), ScheduleModule],
  providers: [ApiKeyRotationService, RotateApiKeysJob],
  exports: [ApiKeyRotationService],
})
export class ApiKeyRotationModule {}
