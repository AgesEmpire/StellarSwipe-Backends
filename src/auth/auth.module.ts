
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { SocialConnection } from './social/entities/social-connection.entity';
import { TwitterOauthService } from './social/twitter-oauth.service';
import { SocialAuthController } from './social/social-auth.controller';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        PassportModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                secret: configService.get<string>('jwt.secret'),
                signOptions: {
                    expiresIn: configService.get('jwt.expiresIn'),
                },
            }),
        }),
        CacheModule,
        TypeOrmModule.forFeature([User, SocialConnection]),
        UsersModule,
    ],
    controllers: [AuthController, SocialAuthController],
    providers: [AuthService, JwtStrategy, JwtAuthGuard, TwitterOauthService],
    exports: [AuthService, JwtAuthGuard, TwitterOauthService],
})
export class AuthModule { }
