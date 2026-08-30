import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity';
import { Signal } from '../../signals/entities/signal.entity';
import { DataLoaderService } from './dataloader.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Signal])],
  providers: [DataLoaderService],
  exports: [DataLoaderService],
})
export class DataLoaderModule {}
