import {
  Controller,
  Get,
  Query,
  Req,
  ParseBoolPipe,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Request } from 'express';
import { FollowerService } from '../providers/services/follower.service';

// Minimal Signal entity reference – replace with your actual entity
import { Signal } from './signal.entity';

@Controller('signals')
export class SignalsController {
  constructor(
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    private readonly followerService: FollowerService,
  ) {}

  // GET /signals/feed?following=true
  @Get('feed')
  async getFeed(
    @Req() req: Request & { user: { id: string } },
    @Query('following') following?: string,
  ) {
    const filterByFollowing = following === 'true';

    if (filterByFollowing) {
      const followedProviderIds = await this.followerService.getFollowedProviderIds(
        req.user.id,
      );

      if (!followedProviderIds.length) {
        return { signals: [], total: 0 };
      }

      const signals = await this.signalRepository.find({
        where: { providerId: In(followedProviderIds) },
        order: { createdAt: 'DESC' },
      });

      return { signals, total: signals.length };
    }

    // Default: return all signals
    const signals = await this.signalRepository.find({
      order: { createdAt: 'DESC' },
    });

    return { signals, total: signals.length };
  }
}
