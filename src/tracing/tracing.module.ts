import { Module } from '@nestjs/common';
import { TracingService, TracingMiddleware } from './tracing.service';

@Module({
  providers: [TracingService, TracingMiddleware],
  exports: [TracingService, TracingMiddleware],
})
export class TracingModule {}
