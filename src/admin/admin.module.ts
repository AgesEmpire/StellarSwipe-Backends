import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminManagementService } from './admin.service';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { AuditLog } from '../audit-log/audit-log.entity';
import { AdminAnalyticsModule } from './analytics/admin-analytics.module';
// The auth modules normally needed to protect these routes
// import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            User,
            Signal,
            AuditLog,
        ]),
        AdminAnalyticsModule,
        // AuthModule
    ],
    controllers: [AdminController],
    providers: [AdminManagementService],
    exports: [AdminManagementService],
})
export class AdminModule { }
