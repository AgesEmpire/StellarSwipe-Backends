import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanService } from './soroban.service';
import { StellarConfigService } from '../config/stellar.service';
import { ContractDeploymentService } from './deployment/contract-deployment.service';
import { SorobanTransactionBuilderService } from './soroban-transaction-builder.service';
import { SorobanSimulationService } from './soroban-simulation.service';
import { SorobanController } from './soroban.controller';
import { MaxCallDepthModule } from '../common/max-call-depth.module';

@Module({
  imports: [MaxCallDepthModule],
  controllers: [SorobanController],
  providers: [
    SorobanService,
    StellarConfigService,
    ContractDeploymentService,
    SorobanTransactionBuilderService,
    SorobanSimulationService,
  ],
  exports: [
    SorobanService,
    ContractDeploymentService,
    SorobanTransactionBuilderService,
    SorobanSimulationService,
  ],
})
export class SorobanModule {}
