import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscordServer } from './entities/discord-server.entity';
import { ChannelSubscription, SubscriptionTopic } from './entities/channel-subscription.entity';
import { DiscordEmbed } from './utils/embed-builder';
import { ServerConfigDto } from './dto/server-config.dto';

@Injectable()
export class DiscordBotService {
  private readonly logger = new Logger(DiscordBotService.name);
  private readonly apiBase: string;
  private readonly botToken: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DiscordServer)
    private readonly serverRepo: Repository<DiscordServer>,
    @InjectRepository(ChannelSubscription)
    private readonly subRepo: Repository<ChannelSubscription>,
  ) {
    this.botToken = this.config.get<string>('DISCORD_BOT_TOKEN') ?? '';
    this.apiBase = 'https://discord.com/api/v10';
  }

  async sendEmbed(channelId: string, embed: DiscordEmbed): Promise<void> {
    try {
      await fetch(`${this.apiBase}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${this.botToken}`,
        },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch (err) {
      this.logger.error(`Failed to send embed to channel ${channelId}`, err);
    }
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    try {
      await fetch(`${this.apiBase}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${this.botToken}`,
        },
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      this.logger.error(`Failed to send message to channel ${channelId}`, err);
    }
  }

  async upsertServer(dto: ServerConfigDto): Promise<DiscordServer> {
    let server = await this.serverRepo.findOne({ where: { guildId: dto.guildId } });
    if (!server) {
      server = this.serverRepo.create(dto);
    } else {
      Object.assign(server, dto);
    }
    return this.serverRepo.save(server);
  }

  async subscribe(guildId: string, channelId: string, topic: SubscriptionTopic): Promise<void> {
    const existing = await this.subRepo.findOne({ where: { guildId, topic } });
    if (existing) {
      existing.channelId = channelId;
      existing.isActive = true;
      await this.subRepo.save(existing);
    } else {
      await this.subRepo.save(this.subRepo.create({ guildId, channelId, topic }));
    }
  }

  async getSubscribedChannels(topic: SubscriptionTopic): Promise<string[]> {
    const subs = await this.subRepo.find({ where: { topic, isActive: true } });
    return subs.map((s) => s.channelId);
  }

  async broadcastToTopic(topic: SubscriptionTopic, embed: DiscordEmbed): Promise<void> {
    const channels = await this.getSubscribedChannels(topic);
    await Promise.allSettled(channels.map((id) => this.sendEmbed(id, embed)));
  }
}
