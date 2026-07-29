import { TelegramBotService } from '../telegram-bot.service';

export async function handlePortfolioCommand(
  service: TelegramBotService,
  telegramId: number,
): Promise<void> {
  // Stub: replace with real portfolio lookup
  const text = `📊 <b>Portfolio</b>\n\nBalance: <b>$0.00</b>\nP&L: <b>$0.00 (0%)</b>\n\nNo open positions.`;
  await service.sendMessage(telegramId, text, 'HTML');
}
