import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramUser } from './entities/telegram-user.entity';
import { BotSubscription } from './entities/bot-subscription.entity';
import { MessageHandler } from './handlers/message.handler';
import { CallbackHandler } from './handlers/callback.handler';
import { InlineHandler } from './handlers/inline.handler';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([TelegramUser, BotSubscription]),
  ],
  providers: [TelegramBotService, MessageHandler, CallbackHandler, InlineHandler],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}
