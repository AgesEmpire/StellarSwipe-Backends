import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialConnection, SocialProvider } from './entities/social-connection.entity';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';

@Injectable()
export class TwitterOauthService {
    private readonly logger = new Logger(TwitterOauthService.name);

    constructor(
        @InjectRepository(SocialConnection)
        private readonly socialRepository: Repository<SocialConnection>,
        private readonly usersService: UsersService,
    ) { }

    async handleTwitterLogin(profile: any, accessToken: string, refreshToken: string): Promise<User> {
        const { id: providerId, username, displayName, photos } = profile;
        const profileImageUrl = photos && photos.length > 0 ? photos[0].value : null;

        // 1. Check if social connection exists
        let connection = await this.socialRepository.findOne({
            where: { provider: SocialProvider.TWITTER, providerId },
            relations: ['user'],
        });

        if (connection) {
            // Update tokens and profile info
            connection.accessToken = accessToken;
            connection.refreshToken = refreshToken;
            connection.username = username;
            connection.displayName = displayName;
            connection.profileImageUrl = profileImageUrl;
            connection.profileData = profile._json;
            await this.socialRepository.save(connection);

            return connection.user;
        }

        // 2. No connection found, create a new user or link to existing (if we had email matching, but Twitter often doesn't give email)
        // For now, create a new "browse-first" user
        const newUser = await this.usersService.createUser({
            username: `tw_${username}_${Math.random().toString(36).substring(7)}`,
            displayName: displayName || username,
            // walletAddress is optional now
        });

        // 3. Create social connection
        connection = this.socialRepository.create({
            userId: newUser.id,
            provider: SocialProvider.TWITTER,
            providerId,
            username,
            displayName,
            profileImageUrl,
            profileData: profile._json,
            accessToken,
            refreshToken,
        });

        await this.socialRepository.save(connection);

        return newUser;
    }

    async getTwitterFollowers(userId: string): Promise<any[]> {
        // In production, use Twitter API with stored accessToken
        this.logger.log(`Fetching Twitter followers for user ${userId}`);
        return []; // Mock
    }
}
