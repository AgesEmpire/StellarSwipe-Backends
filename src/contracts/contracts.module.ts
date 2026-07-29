import { Module } from '@nestjs/common';
import { AbiManagementModule } from './abi-management/abi-management.module';

@Module({
  imports: [AbiManagementModule],
  exports: [AbiManagementModule],
})
export class ContractsModule {}
