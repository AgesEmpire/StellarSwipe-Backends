import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit-log.entity';
import { SecurityAuditService } from './security-audit.service';
import { SecurityAuditInterceptor } from './security-audit.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [SecurityAuditService, SecurityAuditInterceptor],
  exports: [SecurityAuditService, SecurityAuditInterceptor],
})
export class SecurityAuditModule {}
