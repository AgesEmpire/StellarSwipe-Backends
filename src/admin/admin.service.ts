import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../users/entities/user.entity';
import { Signal, SignalStatus } from '../signals/entities/signal.entity';
import { AuditLog, AuditAction, AuditStatus } from '../audit-log/audit-log.entity';
import { UserManagementQueryDto, SuspendUserDto } from './dto/user-management.dto';
import { SignalModerationQueryDto, RemoveSignalDto } from './dto/signal-moderation.dto';
import { AdjustBalanceDto } from './balance/adjust-balance.dto';
import { AccountBalance } from './balance/account-balance.entity';
import { BalanceAdjustment } from './balance/balance-adjustment.entity';

@Injectable()
export class AdminManagementService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Signal)
        private readonly signalRepository: Repository<Signal>,
        @InjectRepository(AuditLog)
        private readonly auditLogRepository: Repository<AuditLog>,
        private readonly eventEmitter: EventEmitter2,
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

        // Suspended users shouldn't surface in provider search results.
        this.eventEmitter.emit('provider.deleted', userId);

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

        // Reinstated users should become searchable again.
        this.eventEmitter.emit('provider.updated', user);

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

    // MANUAL BALANCE ADJUSTMENT
    /** Mutates the balance, adjustment record and audit log in one transaction; any failure rolls all three back. */
    async adjustBalance(adminId: string, dto: AdjustBalanceDto) {
        const reason = dto.reason?.trim();
        if (!reason || reason.length < 10) {
            throw new BadRequestException('A reason of at least 10 characters is required');
        }

        return this.auditLogRepository.manager.transaction(async (manager) => {
            const balance = await manager.findOne(AccountBalance, {
                where: { userId: dto.userId, currency: dto.currency },
                lock: { mode: 'pessimistic_write' },
            });
            if (!balance) {
                throw new NotFoundException(`No ${dto.currency} balance for user ${dto.userId}`);
            }

            const before = balance.amount;
            // Decimal math in the database avoids float rounding on money.
            const [{ after }] = await manager.query('SELECT ($1::numeric + $2::numeric)::text AS after', [before, dto.amount]);
            if (after.startsWith('-')) {
                throw new BadRequestException('Adjustment would make the balance negative');
            }

            balance.amount = after;
            await manager.save(balance);

            const adjustment = await manager.save(
                manager.create(BalanceAdjustment, {
                    userId: dto.userId,
                    actorId: adminId,
                    currency: dto.currency,
                    amountBefore: before,
                    amountAfter: after,
                    reason,
                }),
            );

            await manager.save(
                manager.create(AuditLog, {
                    userId: adminId,
                    action: AuditAction.ADMIN_OVERRIDE,
                    status: AuditStatus.SUCCESS,
                    resource: 'AccountBalance',
                    resourceId: balance.id,
                    metadata: {
                        targetUserId: dto.userId,
                        currency: dto.currency,
                        before,
                        after,
                        reason,
                        timestamp: adjustment.createdAt.toISOString(),
                    },
                }),
            );

            return adjustment;
        });
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
