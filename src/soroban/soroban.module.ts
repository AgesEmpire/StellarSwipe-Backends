import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { StellarConfigService } from '../config/stellar.service';
import { ContractDeploymentService } from './deployment/contract-deployment.service';

@Module({
  providers: [SorobanService, StellarConfigService, ContractDeploymentService],
  exports: [SorobanService, ContractDeploymentService],
})
export class SorobanModule {}
