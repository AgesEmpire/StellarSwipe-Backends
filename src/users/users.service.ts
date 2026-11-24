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

/**
 * Fields a user is allowed to change on their own profile. Anything not
 * listed here (role, isActive, isVerified, permissions, walletAddress,
 * password, internal flags, ...) is ignored on profile updates so request
 * payloads cannot mass-assign protected columns.
 */
const EDITABLE_PROFILE_FIELDS = [
    'username',
    'displayName',
    'email',
    'avatarUrl',
    'bio',
] as const;

type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

/**
 * Unicode normalization policy for user-facing identifiers.
 *
 * Identifiers (username, email) are normalized to Unicode NFC before they are
 * persisted and before they are used in lookups. NFC is the canonical form
 * recommended by the W3C/Unicode standard for interchange, so visually
 * equivalent strings (e.g. "café" composed vs. "cafe\u0301" decomposed) map
 * to a single stored value and cannot bypass uniqueness checks or produce
 * inconsistent lookups. Non-identifier text (displayName, bio, avatarUrl)
 * is left untouched so user-authored content keeps its original form.
 */
const IDENTIFIER_FIELDS = ['username', 'email'] as const;
type IdentifierField = (typeof IDENTIFIER_FIELDS)[number];

/**
 * Normalize a user-facing identifier to NFC. Non-string values are returned
 * unchanged so callers can rely on this being a safe pass-through.
 */
export function normalizeIdentifier<T>(value: T): T {
    if (typeof value !== 'string') {
        return value;
    }
    return value.normalize('NFC') as unknown as T;
}

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

    /**
     * Whitelist the editable profile fields from an untrusted payload. Only
     * keys in EDITABLE_PROFILE_FIELDS are copied; everything else is dropped
     * so protected columns can never be mass-assigned.
     */
    private pickEditableProfileFields(
        payload: Record<string, unknown>,
    ): Partial<Pick<User, EditableProfileField>> {
        const sanitized: Partial<Pick<User, EditableProfileField>> = {};
        for (const field of EDITABLE_PROFILE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(payload, field)) {
                (sanitized as Record<string, unknown>)[field] = payload[field];
            }
        }
        return sanitized;
    }

    /**
     * Apply the NFC normalization policy to identifier fields on a payload
     * before it is persisted. Non-identifier fields are left untouched.
     */
    private normalizeIdentifiers<T extends Record<string, unknown>>(payload: T): T {
        const normalized: Record<string, unknown> = { ...payload };
        for (const field of IDENTIFIER_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(normalized, field)) {
                normalized[field] = normalizeIdentifier(normalized[field]);
            }
        }
        return normalized as T;
    }

    async createUser(createUserDto: CreateUserDto): Promise<User> {
        const normalizedDto = this.normalizeIdentifiers(
            createUserDto as unknown as Record<string, unknown>,
        ) as unknown as CreateUserDto;

        const existingUser = await this.userRepository.findOne({
            where: { walletAddress: normalizedDto.walletAddress },
            withDeleted: true,
        });

        if (existingUser) {
            if (existingUser.deletedAt) {
                // Restore soft-deleted user
                await this.userRepository.restore(existingUser.id);
                return this.findByWalletAddress(normalizedDto.walletAddress!);
            }
            throw new ConflictException('User with this wallet address already exists');
        }

        const user = this.userRepository.create(normalizedDto);
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
            where: { email: normalizeIdentifier(email) },
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
            where: { email: normalizeIdentifier(email) },
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
            where: { username: normalizeIdentifier(username) },
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

    /**
     * Update a user's own profile. Only explicitly editable fields are mapped
     * from the request payload; protected columns (role

/* … truncated 1960 chars — edit only what you need near the top … */
