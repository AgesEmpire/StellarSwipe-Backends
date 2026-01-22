import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { SignalValidatorService } from './validators/signal-validator.service';
import { StakeValidatorService } from './validators/stake-validator.service';
import { Signal } from './entities/signal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Signal]),
    ConfigModule,
  ],
  controllers: [SignalsController],
  providers: [
    SignalsService,
    SignalValidatorService,
    StakeValidatorService,
  ],
  exports: [SignalsService],
})
export class SignalsModule {}