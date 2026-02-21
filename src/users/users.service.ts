import {
    Injectable,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UserPreference } from './entities/user-preference.entity';
import { Session } from './entities/session.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        @InjectRepository(Session)
        private readonly sessionRepository: Repository<Session>,
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

        return this.findById(savedUser.id);
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

        if (!user.preference) {
            const preference = this.preferenceRepository.create({
                userId: user.id,
                ...updatePreferenceDto,
            });
            return this.preferenceRepository.save(preference);
        }

        await this.preferenceRepository.update(user.preference.id, updatePreferenceDto);
        const updatedPreference = await this.preferenceRepository.findOne({
            where: { id: user.preference.id },
        });

        if (!updatedPreference) {
            throw new NotFoundException('Preference not found');
        }

        return updatedPreference;
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

    async getActiveSessions(walletAddress: string): Promise<Session[]> {
        const user = await this.findByWalletAddress(walletAddress);
        return this.sessionRepository.find({
            where: { userId: user.id, isActive: true },
        });
    }

    async updateWalletAddress(userId: string, walletAddress: string): Promise<User> {
        const user = await this.findById(userId);

        // Check if wallet already linked to another user
        const existing = await this.userRepository.findOne({ where: { walletAddress } });
        if (existing && existing.id !== userId) {
            throw new ConflictException('This wallet is already linked to another account');
        }

        user.walletAddress = walletAddress;
        return this.userRepository.save(user);
    }
}
