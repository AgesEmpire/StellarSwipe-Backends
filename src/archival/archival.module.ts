import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ArchivalService } from './archival.service';
import { ArchivalWorker } from './archival.worker';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ArchivalService, ArchivalWorker],
  exports: [ArchivalService],
})
export class ArchivalModule {}
