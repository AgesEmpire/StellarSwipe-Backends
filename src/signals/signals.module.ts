import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Signal } from './entities/signal.entity';
import { CopiedPosition } from './entities/copied-position.entity';
import { SignalsService } from './signals.service';
import { SignalsController } from './signals.controller';
import {
  SignalVersion,
  SignalVersionApproval,
} from './versions/entities/signal-version.entity';
import { SignalVersionService } from './versions/signal-version.service';
import { SignalVersionController } from './versions/signal-version.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Signal,
      CopiedPosition,
      SignalVersion,
      SignalVersionApproval,
    ]),
    BullModule.registerQueueAsync({
      name: 'signal-tracking',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('redis.host') ?? 'localhost',
          port: configService.get<number>('redis.port') ?? 6379,
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db') ?? 0,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),
  ],
  providers: [SignalsService, SignalVersionService],
  controllers: [SignalsController, SignalVersionController],
  exports: [SignalsService, SignalVersionService, TypeOrmModule],
})
export class SignalsModule {}
