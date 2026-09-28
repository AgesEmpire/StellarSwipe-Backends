import { DiscordBotService } from '../discord-bot.service';
import { buildEmbed, COLORS } from '../utils/embed-builder';

export async function handleSignalAlertCommand(
  service: DiscordBotService,
  channelId: string,
): Promise<void> {
  // Stub: replace with real signal query
  const embed = buildEmbed(
    '📡 Latest Signal',
    '_No active signals at the moment._',
    COLORS.neutral,
  );
  await service.sendEmbed(channelId, embed);
}
