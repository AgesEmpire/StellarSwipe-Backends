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
import { TwoFactor } from './two-factor/entities/two-factor.entity';
import { TwoFactorService } from './two-factor/two-factor.service';
import { TwoFactorController } from './two-factor/two-factor.controller';
import { AuthAuditService } from './auth-audit.service';
import { AuditModule } from '../audit-log/audit.module';
import { SessionManagerService } from './session/session-manager.service';
import { SessionCleanupService } from './session/session-cleanup.service';

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
    AuditModule,
    TypeOrmModule.forFeature([User, SocialConnection, TwoFactor]),
    UsersModule,
    EmailModule,
  ],
  controllers: [AuthController, SocialAuthController, TwoFactorController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    TwitterOauthService,
    TwoFactorService,
    AuthAuditService,
    SessionManagerService,
    SessionCleanupService,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    TwitterOauthService,
    TwoFactorService,
    AuthAuditService,
    SessionManagerService,
  ],
})
export class AuthModule {}
