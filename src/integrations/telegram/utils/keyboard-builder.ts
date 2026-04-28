/**
 * Builds inline keyboard markup for Telegram messages.
 */
export function buildInlineKeyboard(
  buttons: { text: string; callbackData: string }[][],
): object {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((btn) => ({ text: btn.text, callback_data: btn.callbackData })),
    ),
  };
}

export function buildMainMenuKeyboard(): object {
  return buildInlineKeyboard([
    [
      { text: '📊 Portfolio', callbackData: 'cmd:portfolio' },
      { text: '📡 Signals', callbackData: 'cmd:signals' },
    ],
    [
      { text: '🔔 Alerts', callbackData: 'cmd:alerts' },
      { text: '❓ Help', callbackData: 'cmd:help' },
    ],
  ]);
}
