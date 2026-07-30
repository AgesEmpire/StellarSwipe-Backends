import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminManagementService } from './admin.service';
import { AdminAuditController } from './admin-audit.controller';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { AdminAnalyticsModule } from './analytics/admin-analytics.module';
import { PermissionAuditService, PermissionAuditLog } from '../auth/permission-audit.service';
import { TracingModule } from '../tracing/tracing.module';
import { QueueModule } from '../queue/queue.module';
import { UserRole } from '../authorization/entities/user-role.entity';
import { AdminAccessGuard } from './access-control/admin-access.guard';
import { AdminAccessPolicyService } from './access-control/admin-access-policy.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            Signal,
            AuditLog,
            PermissionAuditLog,
            UserRole,
        ]),
        AdminAnalyticsModule,
        TracingModule,
        QueueModule,
    ],
    controllers: [AdminController, AdminAuditController],
    providers: [
        AdminManagementService,
        PermissionAuditService,
        AdminAccessPolicyService,
        {
            provide: APP_GUARD,
            useClass: AdminAccessGuard,
        },
    ],
    exports: [AdminManagementService],
})
export class AdminModule { }
