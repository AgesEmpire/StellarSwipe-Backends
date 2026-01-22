import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import { ProvidersController } from './providers.controller';
import { StakeVerificationService } from './services/stake-verification.service';
import { VerificationMonitorJob } from './services/verification-monitor.job';

// Uncomment when Provider entity is created
// import { Provider } from './entities/provider.entity';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    CacheModule.register({
      ttl: 6 * 60 * 60 * 1000, // 6 hours in milliseconds
      max: 1000, // Maximum number of items in cache
    }),
    // Uncomment when Provider entity is created
    // TypeOrmModule.forFeature([Provider]),
  ],
  controllers: [ProvidersController],
  providers: [StakeVerificationService, VerificationMonitorJob],
  exports: [StakeVerificationService, VerificationMonitorJob],
})
export class ProvidersModule {}