import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RollbackProtectionService } from './rollback-protection.service';
import { RollbackRequest } from './entities/rollback-request.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RollbackRequest])],
  providers: [RollbackProtectionService],
  exports: [RollbackProtectionService],
})
export class RollbackProtectionModule {}
