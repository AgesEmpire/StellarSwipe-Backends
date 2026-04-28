import { TelegramBotService } from '../telegram-bot.service';
import { buildInlineKeyboard } from '../utils/keyboard-builder';

export async function handleAlertsCommand(
  service: TelegramBotService,
  telegramId: number,
): Promise<void> {
  const text = `🔔 <b>Alert Subscriptions</b>\n\nChoose what to subscribe to:`;
  const keyboard = buildInlineKeyboard([
    [
      { text: '📡 Signals', callbackData: 'sub:signals' },
      { text: '💼 Trades', callbackData: 'sub:trades' },
    ],
    [{ text: '📊 Portfolio Updates', callbackData: 'sub:portfolio' }],
  ]);
  await service.sendMessage(telegramId, text, 'HTML', keyboard);
}
