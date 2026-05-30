import { Module } from '@nestjs/common';
import { SorobanService } from './soroban.service';
import { StellarConfigService } from '../config/stellar.service';
import { ContractDeploymentService } from './deployment/contract-deployment.service';
import { SorobanTransactionBuilderService } from './soroban-transaction-builder.service';

@Module({
  providers: [SorobanService, StellarConfigService, ContractDeploymentService, SorobanTransactionBuilderService],
  exports: [SorobanService, ContractDeploymentService, SorobanTransactionBuilderService],
})
export class SorobanModule {}
