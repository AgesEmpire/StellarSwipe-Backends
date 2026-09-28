import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanModule } from '../soroban.module';
import { ContractJobEntity } from './contract-job.entity';
import { ContractJobProcessor } from './contract-job.processor';
import { ContractJobService } from './contract-job.service';
import { CONTRACT_JOB_QUEUE } from './contract-job.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: CONTRACT_JOB_QUEUE }),
    TypeOrmModule.forFeature([ContractJobEntity]),
    SorobanModule,
  ],
  providers: [ContractJobProcessor, ContractJobService],
  exports: [ContractJobService],
})
export class ContractJobModule {}
