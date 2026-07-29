import { DiscordBotService } from '../discord-bot.service';
import { buildEmbed, COLORS } from '../utils/embed-builder';

export async function handleMarketStatusCommand(
  service: DiscordBotService,
  channelId: string,
): Promise<void> {
  // Stub: replace with real market data query
  const embed = buildEmbed(
    '🌐 Market Status',
    'Stellar DEX is **online**.\n\n_Live market data coming soon._',
    COLORS.success,
  );
  await service.sendEmbed(channelId, embed);
}
