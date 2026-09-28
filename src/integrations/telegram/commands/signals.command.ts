import { TelegramBotService } from '../telegram-bot.service';

export async function handleSignalsCommand(
  service: TelegramBotService,
  telegramId: number,
): Promise<void> {
  // Stub: replace with real signals query
  const text = `📡 <b>Latest Signals</b>\n\nNo active signals at the moment.`;
  await service.sendMessage(telegramId, text, 'HTML');
}
