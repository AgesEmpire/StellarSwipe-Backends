import { DiscordBotService } from '../discord-bot.service';
import { buildEmbed, COLORS } from '../utils/embed-builder';

export async function handleProviderStatsCommand(
  service: DiscordBotService,
  channelId: string,
  providerName?: string,
): Promise<void> {
  // Stub: replace with real provider stats query
  const embed = buildEmbed(
    `📊 Provider Stats${providerName ? `: ${providerName}` : ''}`,
    '_No provider data available._',
    COLORS.info,
  );
  await service.sendEmbed(channelId, embed);
}
