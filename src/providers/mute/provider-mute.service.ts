import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProviderMute } from '../entities/user-provider-mute.entity';

@Injectable()
export class ProviderMuteService {
  constructor(
    @InjectRepository(UserProviderMute)
    private readonly muteRepo: Repository<UserProviderMute>,
  ) {}

  async mute(userId: string, providerId: string): Promise<void> {
    const exists = await this.muteRepo.findOne({ where: { userId, providerId } });
    if (exists) return;
    await this.muteRepo.save(this.muteRepo.create({ userId, providerId }));
  }

  async unmute(userId: string, providerId: string): Promise<void> {
    await this.muteRepo.delete({ userId, providerId });
  }

  async isMuted(userId: string, providerId: string): Promise<boolean> {
    const count = await this.muteRepo.count({ where: { userId, providerId } });
    return count > 0;
  }

  async getMutedProviderIds(userId: string): Promise<string[]> {
    const mutes = await this.muteRepo.find({
      where: { userId },
      select: ['providerId'],
    });
    return mutes.map((m) => m.providerId);
  }
}
