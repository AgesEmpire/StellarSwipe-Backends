import { Injectable } from '@nestjs/common';
import { TelegramBotService } from '../telegram-bot.service';
import { handlePortfolioCommand } from '../commands/portfolio.command';
import { handleSignalsCommand } from '../commands/signals.command';
import { handleAlertsCommand } from '../commands/alerts.command';
import { handleHelpCommand } from '../commands/help.command';
import { buildMainMenuKeyboard } from '../utils/keyboard-builder';

interface TelegramMessage {
  chat: { id: number };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

@Injectable()
export class MessageHandler {
  constructor(private readonly botService: TelegramBotService) {}

  async handle(message: TelegramMessage): Promise<void> {
    const telegramId = message.chat.id;
    const { username, first_name } = message.from ?? {};

    await this.botService.upsertUser(telegramId, username, first_name);

    const text = (message.text ?? '').trim();
    const command = text.split(' ')[0].toLowerCase();

    switch (command) {
      case '/start':
        await this.botService.sendMessage(
          telegramId,
          `👋 Welcome to <b>StellarSwipe</b>!\n\nUse the menu below to get started.`,
          'HTML',
          buildMainMenuKeyboard(),
        );
        break;
      case '/portfolio':
        await handlePortfolioCommand(this.botService, telegramId);
        break;
      case '/signals':
        await handleSignalsCommand(this.botService, telegramId);
        break;
      case '/alerts':
        await handleAlertsCommand(this.botService, telegramId);
        break;
      case '/help':
      default:
        await handleHelpCommand(this.botService, telegramId);
    }
  }
}
