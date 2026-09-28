import { TelegramBotService } from '../telegram-bot.service';
import { buildMainMenuKeyboard } from '../utils/keyboard-builder';

export async function handleHelpCommand(
  service: TelegramBotService,
  telegramId: number,
): Promise<void> {
  const text =
    `❓ <b>StellarSwipe Bot Help</b>\n\n` +
    `/portfolio — View your portfolio summary\n` +
    `/signals — See latest trading signals\n` +
    `/alerts — Manage alert subscriptions\n` +
    `/help — Show this message`;
  await service.sendMessage(telegramId, text, 'HTML', buildMainMenuKeyboard());
}
