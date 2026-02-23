import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderComparisonController } from './provider-comparison.controller';
import { ProviderComparisonService } from './services/provider-comparison.service';

// Import your actual entities here
// import { Provider } from '../providers/entities/provider.entity';
// import { Signal } from '../signals/entities/signal.entity';

@Module({
  imports: [
    // TypeOrmModule.forFeature([Provider, Signal]),
  ],
  controllers: [ProviderComparisonController],
  providers: [ProviderComparisonService],
  exports: [ProviderComparisonService],
})
export class ProviderComparisonModule {}
