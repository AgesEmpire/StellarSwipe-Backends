import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { FeesService } from './fee.service';
import { FeesController } from './fees.controller';
import { FeeTransaction } from './entities/fee-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeeTransaction]),
    ConfigModule,
  ],
  controllers: [FeesController],
  providers: [FeesService],
  exports: [FeesService],
})
export class FeesModule {}