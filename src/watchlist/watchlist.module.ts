import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistEntry } from './entities/watchlist-entry.entity';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';
import { Signal } from '../signals/entities/signal.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WatchlistEntry, Signal])],
  controllers: [WatchlistController],
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
