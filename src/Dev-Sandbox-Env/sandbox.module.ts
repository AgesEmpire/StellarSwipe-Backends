import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { SandboxEnvironment } from './entities/sandbox-environment.entity';
import { TestDataSnapshot } from './entities/test-data-snapshot.entity';

import { SandboxManagerService } from './sandbox-manager.service';
import { SandboxController } from './sandbox.controller';

import { TestDataGeneratorService } from './services/test-data-generator.service';
import { MockProviderService } from './services/mock-provider.service';
import { SandboxIsolatorService } from './services/sandbox-isolator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SandboxEnvironment, TestDataSnapshot]),
    ScheduleModule.forRoot(),
  ],
  controllers: [SandboxController],
  providers: [
    SandboxManagerService,
    TestDataGeneratorService,
    MockProviderService,
    SandboxIsolatorService,
  ],
  exports: [
    SandboxManagerService,
    MockProviderService,
    TestDataGeneratorService,
  ],
})
export class SandboxModule {}
