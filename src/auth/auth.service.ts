import {
  Injectable,
  Inject,
  Optional,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Keypair } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
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
import { PasswordHasherService } from './password/password-hasher.service';
import { User } from '../users/entities/user.entity';
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

  private readonly passwordHasher: PasswordHasherService;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private authAuditService: AuthAuditService,
    private sessionManager: SessionManagerService,
    private sessionFingerprintService: SessionFingerprintService,
    private emailService: EmailService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() passwordHasher?: PasswordHasherService,
  ) {
    this.passwordHasher = passwordHasher ?? new PasswordHasherService();
  }

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

  /**
   * Links an external OAuth identity (provider + provider account id) to a
   * user account. Before any mutation we validate ownership so that a single
   * external identity can never be attached to more than one user:
   *
   *  - If the identity is already linked to a *different* user, the link is
   *    rejected with a ConflictException and no account state is mutated.
   *  - If the identity is already linked to the *same* user, the call is a
   *    no-op (idempotent) and no duplicate link is created.
   *  - Otherwise the link is created and the successful link is audited.
   *
   * The ownership check + link creation are performed atomically by the
   * users service so concurrent linking attempts cannot both succeed.
   */
  async linkOAuthAccount(
    userId: string,
    provider: string,
    providerAccountId: string,
    req?: Request,
  ): Promise<{ linked: boolean }> {
    if (!userId || !provider || !providerAccountId) {
      throw new UnauthorizedException('Invalid OAuth link request');
    }

    // Resolve the current owner of this external identity, if any.
    const existingOwner = await this.usersService.findByOAuthIdentity(
      provider,
      providerAccountId,
    );

    if (existingOwner && existingOwner.id !== userId) {
      // Identity is owned by another account: reject without mutating state.
      if (req)
        await this.authAuditService.logLoginFailed(
          req,
          `OAuth link conflict: ${provider} identity already linked to another account`,
        );
      throw new ConflictException(
        'This external account is already linked to another user',
      );
    }

    if (existingOwner && existingOwner.id === userId) {
      // Already linked to this user: idempotent success, nothing to mutate.
      return { linked: false };
    }

    // Atomically create the link. The users service re-checks ownership inside
    // the transaction so a concurrent link by another user is rejected rather
    // than silently overwriting the identity.
    const linked = await this.usersService.linkOAuthIdentity(
      userId,
      provider,
      providerAccountId,
    );

    if (!linked) {
      if (req)
        await this.authAuditService.logLoginFailed(
          req,
          `OAuth link conflict: ${provider} identity claimed concurrently`,
        );
      throw new ConflictException(
        'This external account is already linked to another user',
      );
    }

    // Audit the successful link.
    await this.authAuditService.logAction({
      userId,
      action: AuditAction.OAUTH_ACCOUNT_LINKED,
      status: AuditStatus.SUCCESS,
      metadata: { provider, providerAccountId },
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'] as string | undefined,
    });

    return { linked: true };
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
    const hashedPassword = await this.passwordHasher.hash(password);

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

  /**
   * Lists the active sessions belonging to the given user. Sessions are
   * scoped strictly to the authenticated user so callers can never observe
   * another account's sessions.
   */
  async listSessions(userId: string): Promise<any[]> {
    return this.sessionManager.listUserSessions(userId);
  }

  /**
   * Revokes a single session owned by the given user. Throws NotFound when
   * the session does not exist and Forbidden when it belongs to someone else,
   * so a user can never revoke another account's session.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessionManager.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('You cannot revoke this session');
    }
    await this.sessionManager.revokeSession(sessionId);
  }

  private async isAccountLocked(publicKey: string): Promise<boolean> {
    const locked = await this.cacheManager.get<boolean>(
      `auth_lockout:${publicKey}`,
    );
    return locked === true;
  }

  private async recordFailedAttempt(publicKey: string): Promise<void> {
    const key = `auth_failed_attempts:${publicKey}`;
    const current = (await this.cacheManager.get<number>(key)) ?? 0;
    const next = current + 1;

    if (next >= AuthService.MAX_FAILED_ATTEMPTS) {
      await this.cacheManager.set(
        `auth_lockout:${publicKey}`,
        true,
        AuthService.LOCKOUT_DURATION_MS,
      );
      await this.cacheManager.del(key);
      return;
    }

    await this.cacheManager.set(
      key,
      next,
      AuthService.FAILED_ATTEMPTS_WINDOW_MS,
    );
  }

  private async resetFailedAttempts(publicKey: string): Promise<void> {
    await this.cacheManager.del(`auth_failed_attempts:${publicKey}`);
  }
}
