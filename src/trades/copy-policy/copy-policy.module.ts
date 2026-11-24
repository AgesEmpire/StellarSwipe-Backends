import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CopyPolicyVersion, CopyTradeExecution } from './copy-policy-version.entity';
import { CopyPolicyVersionService } from './copy-policy-version.service';

@Module({
  imports: [TypeOrmModule.forFeature([CopyPolicyVersion, CopyTradeExecution])],
  providers: [CopyPolicyVersionService],
  exports: [CopyPolicyVersionService],
})
export class CopyPolicyModule {}
