import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractAbi } from './entities/contract-abi.entity';
import { AbiManagementService } from './abi-management.service';
import { AbiManagementController } from './abi-management.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([ContractAbi]), AuthModule],
  controllers: [AbiManagementController],
  providers: [AbiManagementService],
  exports: [AbiManagementService],
})
export class AbiManagementModule {}
