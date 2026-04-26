import { Module } from '@nestjs/common';
import { TracingService, TracingMiddleware } from './tracing.service';
import { WorkerTracingService } from './worker-tracing.service';

@Module({
  providers: [TracingService, TracingMiddleware, WorkerTracingService],
  exports: [TracingService, TracingMiddleware, WorkerTracingService],
})
export class TracingModule {}
