import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Signal, SignalStatus } from '../signals/entities/signal.entity';
import { AuditLog, AuditAction, AuditStatus } from '../audit-log/audit-log.entity';
import { UserManagementQueryDto, SuspendUserDto } from './dto/user-management.dto';
import { SignalModerationQueryDto, RemoveSignalDto } from './dto/signal-moderation.dto';

@Injectable()
export class AdminManagementService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Signal)
        private readonly signalRepository: Repository<Signal>,
        @InjectRepository(AuditLog)
        private readonly auditLogRepository: Repository<AuditLog>,
    ) { }

    // USER MANAGEMENT
    async getUsers(query: UserManagementQueryDto) {
        const qb = this.userRepository.createQueryBuilder('user');

        if (query.search) {
            qb.andWhere('(user.username ILIKE :search OR user.email ILIKE :search)', {
                search: `%${query.search}%`,
            });
        }

        if (query.isActive !== undefined) {
            qb.andWhere('user.isActive = :isActive', { isActive: query.isActive });
        }

        qb.orderBy(`user.${query.sortBy || 'createdAt'}`, query.order || 'DESC');

        const page = query.page || 1;
        const limit = query.limit || 20;
        qb.skip((page - 1) * limit).take(limit);

        const [items, total] = await qb.getManyAndCount();

        return {
            items,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getUserById(id: string) {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new NotFoundException(`User with ID ${id} not found`);
        }
        return user;
    }

    async suspendUser(adminId: string, userId: string, dto: SuspendUserDto) {
        const user = await this.getUserById(userId);

        if (!user.isActive) {
            throw new BadRequestException('User is already suspended or inactive');
        }

        user.isActive = false;
        // Handle temporary suspension logic here if durationDays is provided (e.g., storing a reactivateAt date)

        await this.userRepository.save(user);

        await this.logAdminAction(adminId, AuditAction.USER_SUSPENDED, 'User', userId, {
            reason: dto.reason,
            durationDays: dto.durationDays
        });

        return user;
    }

    async unsuspendUser(adminId: string, userId: string) {
        const user = await this.getUserById(userId);

        if (user.isActive) {
            throw new BadRequestException('User is already active');
        }

        user.isActive = true;
        await this.userRepository.save(user);

        await this.logAdminAction(adminId, AuditAction.USER_REINSTATED, 'User', userId);

        return user;
    }

    // SIGNAL MODERATION
    async getFlaggedSignals(query: SignalModerationQueryDto) {
        const qb = this.signalRepository.createQueryBuilder('signal')
            .leftJoinAndSelect('signal.provider', 'provider');
        // Real implementation would join with a Reports table or check a `reportsCount` metadata field
        // Since the schema doesn't have an explicit 'flagged' status, assuming checking metadata or relying on the conceptual requirement.
        // E.g: qb.where('signal.metadata->>\'reportsCount\' IS NOT NULL'); 

        if (query.providerId) {
            qb.andWhere('signal.providerId = :providerId', { providerId: query.providerId });
        }

        qb.orderBy(`signal.${query.sortBy || 'createdAt'}`, query.order || 'DESC');

        const page = query.page || 1;
        const limit = query.limit || 20;
        qb.skip((page - 1) * limit).take(limit);

        const [items, total] = await qb.getManyAndCount();

        return {
            items,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async removeSignal(adminId: string, signalId: string, dto: RemoveSignalDto) {
        const signal = await this.signalRepository.findOne({ where: { id: signalId } });
        if (!signal) {
            throw new NotFoundException(`Signal with ID ${signalId} not found`);
        }

        signal.status = SignalStatus.CANCELLED; // Using Cancelled instead of deleting to preserve history, or use SoftDelete
        if (!signal.metadata) {
            signal.metadata = {};
        }
        signal.metadata.removedByAdmin = true;
        signal.metadata.removalReason = dto.reason;

        await this.signalRepository.save(signal);
        await this.signalRepository.softDelete(signal.id); // Also soft delete it

        await this.logAdminAction(adminId, AuditAction.SIGNAL_DELETED, 'Signal', signalId, {
            reason: dto.reason
        });

        return signal;
    }

    // AUDIT LOGGING HELPER
    private async logAdminAction(adminId: string, action: AuditAction, resource: string, resourceId: string, metadata?: Record<string, any>) {
        const auditLog = this.auditLogRepository.create({
            userId: adminId,
            action: action,
            status: AuditStatus.SUCCESS,
            resource,
            resourceId,
            metadata: metadata || {}
        });

        await this.auditLogRepository.save(auditLog);
    }
}
