import { Injectable } from '@nestjs/common';
import { TelegramBotService } from '../telegram-bot.service';
import { SubscriptionType } from '../entities/bot-subscription.entity';
import { handlePortfolioCommand } from '../commands/portfolio.command';
import { handleSignalsCommand } from '../commands/signals.command';

interface CallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
}

@Injectable()
export class CallbackHandler {
  constructor(private readonly botService: TelegramBotService) {}

  async handle(query: CallbackQuery): Promise<void> {
    const telegramId = query.from.id;
    const data = query.data ?? '';
    const [prefix, value] = data.split(':');

    if (prefix === 'sub') {
      await this.botService.subscribe(telegramId, value as SubscriptionType);
      await this.botService.sendMessage(
        telegramId,
        `✅ Subscribed to <b>${value}</b> alerts.`,
        'HTML',
      );
    } else if (prefix === 'cmd') {
      switch (value) {
        case 'portfolio':
          await handlePortfolioCommand(this.botService, telegramId);
          break;
        case 'signals':
          await handleSignalsCommand(this.botService, telegramId);
          break;
      }
    }
  }
}
