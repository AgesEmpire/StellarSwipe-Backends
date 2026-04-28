import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatternAnalyzerService } from './pattern-analyzer.service';
import { PatternController } from './pattern.controller';
import { TradingPattern } from './entities/trading-pattern.entity';
import { PatternInsight } from './entities/pattern-insight.entity';
import { Trade } from '../../trades/entities/trade.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TradingPattern, PatternInsight, Trade])],
  controllers: [PatternController],
  providers: [PatternAnalyzerService],
  exports: [PatternAnalyzerService],
})
export class TradePatternsModule {}
