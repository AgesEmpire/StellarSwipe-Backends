import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminManagementService } from './admin.service';
import { AdminAuditController } from './admin-audit.controller';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { AdminAnalyticsModule } from './analytics/admin-analytics.module';
import { PermissionAuditService, PermissionAuditLog } from '../auth/permission-audit.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            Signal,
            AuditLog,
            PermissionAuditLog,
        ]),
        AdminAnalyticsModule,
    ],
    controllers: [AdminController, AdminAuditController],
    providers: [AdminManagementService, PermissionAuditService],
    exports: [AdminManagementService],
})
export class AdminModule { }
