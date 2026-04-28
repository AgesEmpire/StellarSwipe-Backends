import { Injectable } from '@nestjs/common';
import { DiscordBotService } from '../discord-bot.service';
import { handleLeaderboardCommand } from '../commands/leaderboard.command';
import { handleSignalAlertCommand } from '../commands/signal-alert.command';
import { handleProviderStatsCommand } from '../commands/provider-stats.command';
import { handleMarketStatusCommand } from '../commands/market-status.command';

interface SlashInteraction {
  commandName: string;
  channelId: string;
  options?: Record<string, string>;
}

@Injectable()
export class InteractionCreateEvent {
  constructor(private readonly botService: DiscordBotService) {}

  async handle(interaction: SlashInteraction): Promise<void> {
    switch (interaction.commandName) {
      case 'leaderboard':
        await handleLeaderboardCommand(this.botService, interaction.channelId);
        break;
      case 'signal':
        await handleSignalAlertCommand(this.botService, interaction.channelId);
        break;
      case 'provider':
        await handleProviderStatsCommand(this.botService, interaction.channelId, interaction.options?.['name']);
        break;
      case 'market':
        await handleMarketStatusCommand(this.botService, interaction.channelId);
        break;
    }
  }
}
