import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Signal } from './signal.entity';
import { SignalsController } from './signals.controller';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [TypeOrmModule.forFeature([Signal]), ProvidersModule],
  controllers: [SignalsController],
})
export class SignalsModule {}
