import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeeBumpService } from './fee-bump.service';
import { FeeBumpController } from './fee-bump.controller';

@Module({
  imports: [ConfigModule],
  controllers: [FeeBumpController],
  providers: [FeeBumpService],
  exports: [FeeBumpService],
})
export class FeeBumpModule {}
