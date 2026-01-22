import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskSettings } from './entities/risk-settings.entity';
import { RiskManagerService } from './risk-manager.service';

@Module({
  imports: [TypeOrmModule.forFeature([RiskSettings])],
  providers: [RiskManagerService],
  exports: [RiskManagerService],
})
export class RiskManagerModule {}
