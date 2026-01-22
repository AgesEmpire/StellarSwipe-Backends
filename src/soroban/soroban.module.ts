import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { StellarConfigService } from '../config/stellar.service';

@Module({
  providers: [SorobanService, StellarConfigService],
  exports: [SorobanService],
})
export class SorobanModule {}
