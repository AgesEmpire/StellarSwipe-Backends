import { Injectable } from '@nestjs/common';
import { DiscordBotService } from '../discord-bot.service';
import { handleLeaderboardCommand } from '../commands/leaderboard.command';
import { handleSignalAlertCommand } from '../commands/signal-alert.command';
import { handleProviderStatsCommand } from '../commands/provider-stats.command';
import { handleMarketStatusCommand } from '../commands/market-status.command';

interface DiscordMessage {
  channelId: string;
  content: string;
  author: { bot: boolean };
}

@Injectable()
export class MessageCreateEvent {
  constructor(private readonly botService: DiscordBotService) {}

  async handle(message: DiscordMessage): Promise<void> {
    if (message.author.bot) return;

    const [cmd, ...args] = message.content.trim().split(' ');

    switch (cmd.toLowerCase()) {
      case '!leaderboard':
        await handleLeaderboardCommand(this.botService, message.channelId);
        break;
      case '!signal':
        await handleSignalAlertCommand(this.botService, message.channelId);
        break;
      case '!provider':
        await handleProviderStatsCommand(this.botService, message.channelId, args[0]);
        break;
      case '!market':
        await handleMarketStatusCommand(this.botService, message.channelId);
        break;
    }
  }
}
