import {
  Injectable,
  Inject,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Keypair } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { AuthAuditService } from './auth-audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';
import { SessionManagerService } from './session/session-manager.service';
import { SessionFingerprintService } from './session/session-fingerprint.service';
import { EmailService } from '../email/email.service';
import { Request } from 'express';

@Injectable()
export class AuthService {
  // Approximate P50 latency of a real forgotPassword lookup + email dispatch.
  // Non-existent-user requests are padded up to this floor so response timing
  // cannot be used to enumerate registered emails.
  private static readonly FORGOT_PASSWORD_RESPONSE_FLOOR_MS = 150;

  // Account lockout thresholds for failed challenge/verify attempts.
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly FAILED_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;
  private static readonly LOCKOUT_DURATION_MS = 30 * 60 * 1000;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private authAuditService: AuthAuditService,
    private sessionManager: SessionManagerService,
    private sessionFingerprintService: SessionFingerprintService,
    private emailService: EmailService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async generateChallenge(publicKey: string): Promise<{ message: string }> {
    const nonce = crypto.randomBytes(32).toString('hex');
    const message = `Sign this message to authenticate with StellarSwipe: ${nonce}`;

    // Store challenge in Redis with 5 min TTL
    await this.cacheManager.set(`auth_challenge:${publicKey}`, message, 300000); // 300s = 5m. Check if cache manager expects ms or s.

    return { message };
  }

  async verifySignature(
    dto: VerifySignatureDto,
    req?: Request,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { publicKey, signature, message } = dto;

    // 0. Reject outright if the account is currently locked out
    if (await this.isAccountLocked(publicKey)) {
      if (req) await this.authAuditService.logLoginFailed(req, 'Account locked');
      throw new ForbiddenException(
        'Account temporarily locked due to too many failed attempts. Please try again later.',
      );
    }

    // 1. Retrieve challenge from Redis
    const storedMessage = await this.cacheManager.get<string>(
      `auth_challenge:${publicKey}`,
    );

    if (!storedMessage) {
      if (req)
        await this.authAuditService.logLoginFailed(
          req,
          'Challenge expired or not found',
        );
      await this.recordFailedAttempt(publicKey);
      throw new UnauthorizedException(
        'Challenge expired or not found. Please request a new challenge.',
      );
    }

    if (storedMessage !== message) {
      if (req)
        await this.authAuditService.logLoginFailed(req, 'Message mismatch');
      await this.recordFailedAttempt(publicKey);
      throw new UnauthorizedException(
        'Message mismatch. Please sign the correct challenge.',
      );
    }

    // 2. Verify signature
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const isValid = keypair.verify(
        Buffer.from(message),
        Buffer.from(signature, 'base64'),
      );

      if (!isValid) {
        if (req)
          await this.authAuditService.logLoginFailed(req, 'Invalid signature');
        throw new UnauthorizedException('Invalid signature');
      }
    } catch (error) {
      if (req)
        await this.authAuditService.logLoginFailed(
          req,
          'Signature verification failed',
        );
      await this.recordFailedAttempt(publicKey);
      throw new UnauthorizedException('Signature verification failed');
    }

    // 3. Clear challenge after successful verification (prevent replay)
    await this.cacheManager.del(`auth_challenge:${publicKey}`);

    // Successful verification: clear any accumulated failed-attempt count
    await this.resetFailedAttempts(publicKey);

    // 4. Find or create user
    const user = await this.usersService.findOrCreateByWalletAddress(publicKey);

    // 5. Issue secure token pair with session tracking
    const tokens = await this.sessionManager.issueTokens(user.id, publicKey, {
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });

    if (req) await this.authAuditService.logLogin(user.id, req);

    // 6. Fingerprint this login (IP + user-agent + accept-language) and
    // flag/log if it doesn't match the user's recent login history.
    await this.sessionFingerprintService.checkAndRecord(user.id, {
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'] as string | undefined,
      acceptLanguage: req?.headers?.['accept-language'] as string | undefined,
    });

    return tokens;
  }

  async register(
    dto: RegisterDto,
  ): Promise<{ user: any; accessToken: string }> {
    const { email, password, displayName, username } = dto;

    // Check if user already exists
    try {
      const existingUser = await this.usersService.findByEmail(email);
      if (existingUser) {
        throw new UnauthorizedException('User with this email already exists');
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await this.usersService.createUser({
      email,
      password: hashedPassword,
      displayName: displayName || email.split('@')[0],
      username: username || email.split('@')[0],
    });

    // Send welcome email
    try {
      await this.emailService.sendEmail({
        to: email,
        subject: 'Welcome to StellarSwipe',
        template: 'welcome',
        variables: {
          name: user.displayName || user.username,
          link: 'https://stellarswipe.com/dashboard',
        },
      });
    } catch (emailError) {
      // Log email error but don't fail registration
      console.error('Failed to send welcome email:', emailError);
    }

    // Generate JWT
    const payload: JwtPayload = { sub: user.id };
    const accessToken = this.jwtService.sign(payload);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
      },
      accessToken,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = dto;
    const startedAt = Date.now();

    let user: { id: string; displayName?: string; username?: string } | null =
      null;
    try {
      user = await this.usersService.findByEmail(email);
    } catch (error) {
      // We should not reveal if user exists or not for security reasons
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
    }

    if (user) {
      // Generate secure token
      const token = crypto.randomBytes(32).toString('hex');

      // Store token in cache with 1 hour TTL
      await this.cacheManager.set(`pwd_reset:${token}`, user.id, 3600000); // 1h in ms

      // Send email
      await this.emailService.sendEmail({
        to: email,
        subject: 'Password Reset Request',
        template: 'password-reset',
        variables: {
          name: user.displayName || user.username,
          link: `https://stellarswipe.com/reset-password?token=${token}`,
        },
      });
    }

    // Pad the response so a non-existent-user request takes as long as a
    // real lookup + email dispatch, preventing enumeration via timing.
    await this.padToMinimumDuration(
      startedAt,
      AuthService.FORGOT_PASSWORD_RESPONSE_FLOOR_MS,
    );

    // Always return the same message and shape regardless of whether the
    // account exists, so the response body cannot be used to enumerate emails.
    return {
      message: 'If this email is registered, you will receive a reset link.',
    };
  }

  private async padToMinimumDuration(
    startedAt: number,
    floorMs: number,
  ): Promise<void> {
    const remaining = floorMs - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const { token, newPassword } = dto;

    // 1. Retrieve user ID from cache
    const userId = await this.cacheManager.get<string>(`pwd_reset:${token}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // 2. Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 3. Update password
    await this.usersService.updatePassword(userId, hashedPassword);

    // 4. Clear token from cache
    await this.cacheManager.del(`pwd_reset:${token}`);

    return { message: 'Password has been successfully reset' };
  }

  private async isAccountLocked(publicKey: string): Promise<boolean> {
    const lockedUntil = await this.cacheManager.get<number>(
      `auth_lockout:${publicKey}`,
    );
    return !!lockedUntil;
  }

  private async recordFailedAttempt(publicKey: string): Promise<void> {
    const key = `auth_failed_attempts:${publicKey}`;
    const attempts = (await this.cacheManager.get<number>(key)) ?? 0;
    const nextAttempts = attempts + 1;

    if (nextAttempts >= AuthService.MAX_FAILED_ATTEMPTS) {
      await this.lockAccount(publicKey);
      await this.cacheManager.del(key);
      return;
    }

    await this.cacheManager.set(
      key,
      nextAttempts,
      AuthService.FAILED_ATTEMPTS_WINDOW_MS,
    );
  }

  private async resetFailedAttempts(publicKey: string): Promise<void> {
    await this.cacheManager.del(`auth_failed_attempts:${publicKey}`);
  }

  private async lockAccount(publicKey: string): Promise<void> {
    await this.cacheManager.set(
      `auth_lockout:${publicKey}`,
      Date.now() + AuthService.LOCKOUT_DURATION_MS,
      AuthService.LOCKOUT_DURATION_MS,
    );

    this.authAuditService
      .logAuthEvent({
        action: AuditAction.ACCOUNT_LOCKED,
        endpoint: '/auth/verify',
        method: 'POST',
        status: AuditStatus.SUCCESS,
        metadata: { publicKey },
      })
      .catch(() => undefined);

    try {
      const user = await this.usersService.findByWalletAddress(publicKey);
      if (user.email) {
        await this.emailService.sendEmail({
          to: user.email,
          subject: 'Your account has been locked',
          template: 'security-alert',
          variables: {
            name: user.displayName || user.username || 'there',
            alertType: 'Account locked after repeated failed sign-in attempts',
            occurredAt: new Date(),
            link: 'https://stellarswipe.com/support',
          },
        });
      }
    } catch (error) {
      // User may not exist yet, or may have no email on file. Never let
      // notification failures block the lockout itself.
    }
  }

  async unlockAccount(publicKey: string): Promise<{ message: string }> {
    await this.cacheManager.del(`auth_lockout:${publicKey}`);
    await this.cacheManager.del(`auth_failed_attempts:${publicKey}`);

    await this.authAuditService
      .logAuthEvent({
        action: AuditAction.ACCOUNT_UNLOCKED,
        endpoint: '/auth/unlock',
        method: 'POST',
        status: AuditStatus.SUCCESS,
        metadata: { publicKey },
      })
      .catch(() => undefined);

    return { message: 'Account unlocked' };
  }
}
