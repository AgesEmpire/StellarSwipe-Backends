import { Injectable } from '@nestjs/common';
import { TelegramBotService } from '../telegram-bot.service';

interface InlineQuery {
  id: string;
  from: { id: number };
  query: string;
}

@Injectable()
export class InlineHandler {
  constructor(private readonly botService: TelegramBotService) {}

  async handle(query: InlineQuery): Promise<void> {
    // Stub: inline query results would be answered via answerInlineQuery API
    // For now, just log — extend with real signal search results
    void query;
    void this.botService;
  }
}
