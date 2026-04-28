import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { ProfileSession } from './entities/profile-session.entity';
import { PerformanceSnapshot } from './entities/performance-snapshot.entity';

import { ProfilerService } from './profiler.service';
import { ProfilerController } from './profiler.controller';

import { CpuProfiler } from './collectors/cpu-profiler';
import { MemoryProfiler } from './collectors/memory-profiler';
import { QueryProfiler } from './collectors/query-profiler';
import { ApiProfiler } from './collectors/api-profiler';

import { BottleneckDetector } from './analyzers/bottleneck-detector';
import { FlameGraphGenerator } from './analyzers/flamegraph-generator';

import { TraceAggregator } from './utils/trace-aggregator';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ProfileSession, PerformanceSnapshot]),
  ],
  controllers: [ProfilerController],
  providers: [
    ProfilerService,

    // Collectors
    CpuProfiler,
    MemoryProfiler,
    QueryProfiler,
    ApiProfiler,

    // Analyzers
    BottleneckDetector,
    FlameGraphGenerator,

    // Utils
    TraceAggregator,
  ],
  exports: [
    ProfilerService,
    QueryProfiler, // export so TypeORM/other modules can call onQueryStart/onQueryEnd
    ApiProfiler,   // export as a global NestJS interceptor in AppModule if needed
  ],
})
export class ProfilerModule {}
