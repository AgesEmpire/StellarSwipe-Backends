import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WatchlistEntry } from './entities/watchlist-entry.entity';
import { Signal } from '../signals/entities/signal.entity';
import { WatchlistActivityQueryDto } from './dto/watchlist-activity-query.dto';

export interface WatchlistActivityPage {
  data: Signal[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistEntry)
    private readonly watchlistRepo: Repository<WatchlistEntry>,
    @InjectRepository(Signal)
    private readonly signalRepo: Repository<Signal>,
  ) {}

  /**
   * Add a trader to the user's watchlist. Idempotent — duplicate adds are
   * silently accepted and return the existing entry.
   */
  async add(userId: string, traderId: string): Promise<WatchlistEntry> {
    const existing = await this.watchlistRepo.findOne({
      where: { userId, traderId },
    });
    if (existing) {
      return existing;
    }
    const entry = this.watchlistRepo.create({ userId, traderId });
    return this.watchlistRepo.save(entry);
  }

  /**
   * Remove a trader from the user's watchlist. No-ops if the entry does not
   * exist.
   */
  async remove(userId: string, traderId: string): Promise<void> {
    await this.watchlistRepo.delete({ userId, traderId });
  }

  /**
   * Return all watchlist entries for a user.
   */
  async list(userId: string): Promise<WatchlistEntry[]> {
    return this.watchlistRepo.find({
      where: { userId },
      order: { addedAt: 'DESC' },
    });
  }

  /**
   * Return paginated recent signal activity for all traders on the user's
   * watchlist. This query is completely independent of the copy-trading feed.
   */
  async getActivity(
    userId: string,
    query: WatchlistActivityQueryDto,
  ): Promise<WatchlistActivityPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const entries = await this.watchlistRepo.find({
      where: { userId },
      select: ['traderId'],
    });

    if (entries.length === 0) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
      };
    }

    const traderIds = entries.map((e) => e.traderId);

    const [signals, total] = await this.signalRepo.findAndCount({
      where: { providerId: In(traderIds) },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      data: signals,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}
