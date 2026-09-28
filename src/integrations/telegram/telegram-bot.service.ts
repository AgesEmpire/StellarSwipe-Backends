import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser } from './entities/telegram-user.entity';
import { BotSubscription, SubscriptionType } from './entities/bot-subscription.entity';

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly apiBase: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TelegramUser)
    private readonly userRepo: Repository<TelegramUser>,
    @InjectRepository(BotSubscription)
    private readonly subRepo: Repository<BotSubscription>,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(
    telegramId: number,
    text: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
    replyMarkup?: object,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      chat_id: telegramId,
      text,
      parse_mode: parseMode,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    try {
      await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`Failed to send message to ${telegramId}`, err);
    }
  }

  async upsertUser(telegramId: number, username?: string, firstName?: string): Promise<TelegramUser> {
    let user = await this.userRepo.findOne({ where: { telegramId } });
    if (!user) {
      user = this.userRepo.create({ telegramId, username, firstName });
    } else {
      user.username = username ?? user.username;
      user.firstName = firstName ?? user.firstName;
    }
    return this.userRepo.save(user);
  }

  async subscribe(telegramId: number, type: SubscriptionType): Promise<void> {
    const existing = await this.subRepo.findOne({ where: { telegramId, type } });
    if (existing) {
      existing.isActive = true;
      await this.subRepo.save(existing);
    } else {
      await this.subRepo.save(this.subRepo.create({ telegramId, type }));
    }
  }

  async unsubscribe(telegramId: number, type: SubscriptionType): Promise<void> {
    await this.subRepo.update({ telegramId, type }, { isActive: false });
  }

  async getActiveSubscribers(type: SubscriptionType): Promise<number[]> {
    const subs = await this.subRepo.find({ where: { type, isActive: true } });
    return subs.map((s) => Number(s.telegramId));
  }

  async broadcastAlert(type: SubscriptionType, message: string): Promise<void> {
    const subscribers = await this.getActiveSubscribers(type);
    await Promise.allSettled(
      subscribers.map((id) => this.sendMessage(id, message)),
    );
  }
}
