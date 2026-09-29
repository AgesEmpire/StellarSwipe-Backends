import {
    Injectable,
    Logger,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from './entities/user.entity';
import { UserPreference } from './entities/user-preference.entity';
import { Session } from './entities/session.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { restoreOrThrow } from '../common/services/soft-delete.helper';
import { CacheInvalidationService } from '../cache/cache-invalidation.service';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        @InjectRepository(Session)
        private readonly sessionRepository: Repository<Session>,
        private readonly cacheInvalidation: CacheInvalidationService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    async createUser(createUserDto: CreateUserDto): Promise<User> {
        const existingUser = await this.userRepository.findOne({
            where: { walletAddress: createUserDto.walletAddress },
            withDeleted: true,
        });

        if (existingUser) {
            if (existingUser.deletedAt) {
                // Restore soft-deleted user
                await this.userRepository.restore(existingUser.id);
                return this.findByWalletAddress(createUserDto.walletAddress!);
            }
            throw new ConflictException('User with this wallet address already exists');
        }

        const user = this.userRepository.create(createUserDto);
        const savedUser = await this.userRepository.save(user);

        // Create default preferences for new user
        const preference = this.preferenceRepository.create({
            userId: savedUser.id,
        });
        await this.preferenceRepository.save(preference);

        const created = await this.findById(savedUser.id);
        this.emitSafely('provider.created', created);
        return created;
    }

    /**
     * Fire an entity-change event without letting a listener failure (e.g. a
     * search-index refresh error) break the write path that triggered it.
     */
    private emitSafely(event: string, payload: unknown): void {
        try {
            this.eventEmitter.emit(event, payload);
        } catch (error) {
            this.logger.warn(`Failed to emit '${event}' event`, (error as Error).message);
        }
    }

    async findById(id: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { id },
            relations: ['preference', 'sessions'],
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    /**
     * Resolve a user for security-event processing without throwing when the
     * account is missing or soft-deleted. Returns null so callers can handle
     * the absence deterministically and without leaking account existence.
     */
    async findByIdForSecurityEvent(id: string): Promise<User | null> {
        if (!id) {
            return null;
        }

        try {
            return await this.userRepository.findOne({
                where: { id },
                withDeleted: true,
            });
        } catch (error) {
            this.logger.warn(
                'Security-event user lookup failed',
                (error as Error).message,
            );
            return null;
        }
    }

    async findByWalletAddress(walletAddress: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { walletAddress },
            relations: ['preference', 'sessions'],
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async findByEmail(email: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { email },
            relations: ['preference', 'sessions'],
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    /**
     * Looks up a user together with their password hash, which is excluded
     * from default selects. Returns null rather than throwing so callers can
     * keep credential failures indistinguishable.
     */
    async findByEmailWithPassword(email: string): Promise<User | null> {
        return this.userRepository.findOne({
            where: { email },
            select: {
                id: true,
                email: true,
                username: true,
                displayName: true,
                walletAddress: true,
                isActive: true,
                password: true,
            },
        });
    }

    async updatePassword(userId: string, passwordHash: string): Promise<void> {
        await this.userRepository.update({ id: userId }, { password: passwordHash });
    }

    /**
     * Compare-and-set password write: only replaces the hash if it still
     * equals `expectedHash`, so a background rehash can never overwrite a
     * password that was reset concurrently. Returns whether a row changed.
     */
    async updatePasswordIfUnchanged(
        userId: string,
        expectedHash: string,
        passwordHash: string,
    ): Promise<boolean> {
        const result = await this.userRepository.update(
            { id: userId, password: expectedHash },
            { password: passwordHash },
        );
        return (result.affected ?? 0) > 0;
    }

    async findByUsername(username: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { username },
            relations: ['preference', 'sessions'],
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    async findOrCreateByWalletAddress(walletAddress: string): Promise<User> {
        try {
            return await this.findByWalletAddress(walletAddress);
        } catch {
            // Generate a username from wallet address (first 8 chars)
            const username = `user_${walletAddress.substring(1, 9).toLowerCase()}`;
            return this.createUser({ username, walletAddress });
        }
    }

    async updatePreferences(
        walletAddress: string,
        updatePreferenceDto: UpdatePreferenceDto,
    ): Promise<UserPreference> {
        const user = await this.findByWalletAddress(walletAddress);

        let result: UserPreference;
        if (!user.preference) {
            const preference = this.preferenceRepository.create({
                userId: user.id,
                ...updatePreferenceDto,
            });
            result = await this.preferenceRepository.save(preference);
        } else {
            await this.preferenceRepository.update(user.preference.id, updatePreferenceDto);
            const updatedPreference = await this.preferenceRepository.findOne({
                where: { id: user.preference.id },
            });
            if (!updatedPreference) {
                throw new NotFoundException('Preference not found');
            }
            result = updatedPreference;
        }

        // Write-through invalidation: evict stale user profile cache
        await this.cacheInvalidation.invalidateUserPreferences(user.id);
        return result;
    }

    async getPreferences(walletAddress: string): Promise<UserPreference> {
        const user = await this.findByWalletAddress(walletAddress);

        if (!user.preference) {
            throw new NotFoundException('User preferences not found');
        }

        return user.preference;
    }

    async updateLastLogin(walletAddress: string): Promise<void> {
        const user = await this.findByWalletAddress(walletAddress);
        await this.userRepository.update(user.id, { lastLoginAt: new Date() });
    }

    async softDelete(walletAddress: string): Promise<void> {
        const user = await this.findByWalletAddress(walletAddress);
        await this.userRepository.softDelete(user.id);
    }

    async restore(walletAddress: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { walletAddress },
            withDeleted: true,
        });
        if (!user) {
            throw new NotFoundException('User not found');
        }
        await restoreOrThrow(this.userRepository, user.id, 'User not found');
        return this.findByWalletAddress(walletAddress);
    }

    async createSession(
        walletAddress: string,
        token: string,
        expiresAt: Date,
        deviceInfo?: string,
        ipAddress?: string,
    ): Promise<Session> {
        const user = await this.findByWalletAddress(walletAddress);

        const session = this.sessionRepository.create({
            userId: user.id,
            token,
            expiresAt,
            deviceInfo,
            ipAddress,
            lastActivityAt: new Date(),
        });

        return this.sessionRepository.save(session);
    }

    async findSessionByToken(token: string): Promise<Session | null> {
        return this.sessionRepository.findOne({
            where: { token, isActive: true },
            relations: ['user'],
        });
    }

    async invalidateSession(token: string): Promise<void> {
        await this.sessionRepository.update({ token }, { isActive: false });
    }

    async invalidateAllUserSessions(walletAddress: string): Promise<void> {
        const user = await this.findByWalletAddress(walletAddress);
        await this.sessionRepository.update({ userId: user.id }, { isActive: false });
    }

    async updateSessionActivity(token: string): Promise<void> {
        await this.sessionRepository.update(
            { token },
            { lastActivityAt: new Date() },
        );
    }
}
