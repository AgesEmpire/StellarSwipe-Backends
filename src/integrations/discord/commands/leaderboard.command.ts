import { DiscordBotService } from '../discord-bot.service';
import { buildEmbed, COLORS } from '../utils/embed-builder';

export async function handleLeaderboardCommand(
  service: DiscordBotService,
  channelId: string,
): Promise<void> {
  // Stub: replace with real leaderboard query
  const embed = buildEmbed(
    '🏆 Leaderboard',
    'Top traders this week:\n\n_No data available yet._',
    COLORS.info,
  );
  await service.sendEmbed(channelId, embed);
}
