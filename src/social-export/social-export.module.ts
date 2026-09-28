import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SocialExportService } from './social-export.service';
import { SocialExportController } from './social-export.controller';
import { Trade } from '../trades/entities/trade.entity';
import { Signal } from '../signals/entities/signal.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Trade, Signal])],
  controllers: [SocialExportController],
  providers: [SocialExportService],
  exports: [SocialExportService],
})
export class SocialExportModule {}
