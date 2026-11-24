import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderComparisonController } from './provider-comparison.controller';
import { ProviderComparisonService } from './services/provider-comparison.service';
import { Signal } from '../signals/entities/signal.entity';
import { ProviderWindowPerformanceController } from './provider-window-performance.controller';
import {
  PERFORMANCE_SAMPLE_SOURCE,
  ProviderWindowPerformanceService,
} from './services/provider-window-performance.service';
import { SignalPerformanceSampleSource } from './services/signal-performance-sample.source';

// Import your actual entities here
// import { Provider } from '../providers/entities/provider.entity';
// import { Signal } from '../signals/entities/signal.entity';

@Module({
  imports: [
    // TypeOrmModule.forFeature([Provider, Signal]),
    TypeOrmModule.forFeature([Signal]),
  ],
  controllers: [ProviderComparisonController, ProviderWindowPerformanceController],
  providers: [
    ProviderComparisonService,
    ProviderWindowPerformanceService,
    SignalPerformanceSampleSource,
    { provide: PERFORMANCE_SAMPLE_SOURCE, useExisting: SignalPerformanceSampleSource },
  ],
  exports: [ProviderComparisonService, ProviderWindowPerformanceService],
})
export class ProviderComparisonModule {}
