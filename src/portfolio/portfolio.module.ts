import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortfolioService } from './portfolio.service';
import { PortfolioController } from './portfolio.controller';
import { Trade } from '../trades/entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { PriceService } from '../shared/price.service';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
      TypeOrmModule.forFeature([Trade, User]),
      CacheModule.register(),
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService, PriceService],
})
export class PortfolioModule {}
