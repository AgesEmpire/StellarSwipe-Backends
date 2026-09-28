import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DiscordBotService } from './discord-bot.service';
import { DiscordServer } from './entities/discord-server.entity';
import { ChannelSubscription } from './entities/channel-subscription.entity';
import { MessageCreateEvent } from './events/message-create.event';
import { InteractionCreateEvent } from './events/interaction-create.event';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([DiscordServer, ChannelSubscription]),
  ],
  providers: [DiscordBotService, MessageCreateEvent, InteractionCreateEvent],
  exports: [DiscordBotService],
})
export class DiscordBotModule {}
