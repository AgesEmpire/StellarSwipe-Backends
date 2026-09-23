import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { WebauthnCredential } from './entities/webauthn-credential.entity';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';
import { BeginWebauthnLoginDto } from './dto/begin-login.dto';
import { VerifyWebauthnLoginDto } from './dto/verify-login.dto';
import { UsersService } from '../../users/users.service';
import { SessionManagerService } from '../session/session-manager.service';
import { User } from '../../users/entities/user.entity';
import { ChallengeStoreService, ChallengeType } from '../challenge/challenge-store.service';

const MAX_CREDENTIALS_PER_USER = 10;

@Injectable()
export class WebauthnService {
  private readonly logger = new Logger(WebauthnService.name);
  private readonly rpName: string;
  private readonly rpID: string;
  private readonly origin: string | string[];
  private readonly registrationChallengeTtlMs: number;
  private readonly loginChallengeTtlMs: number;

  constructor(
    @InjectRepository(WebauthnCredential)
    private readonly credentialRepo: Repository<WebauthnCredential>,
    private readonly usersService: UsersService,
    private readonly sessionManager: SessionManagerService,
    private readonly configService: ConfigService,
    private readonly challengeStore: ChallengeStoreService,
  ) {
    this.rpName = this.configService.get<string>('WEBAUTHN_RP_NAME', 'StellarSwipe');
    this.rpID = this.configService.get<string>('WEBAUTHN_RP_ID', 'localhost');
    const origin = this.configService.get<string>('WEBAUTHN_ORIGIN', `http://localhost:3000`);
    this.origin = origin.includes(',') ? origin.split(',').map((o) => o.trim()) : origin;
    this.registrationChallengeTtlMs = this.configService.get<number>(
      'WEBAUTHN_REGISTRATION_CHALLENGE_TTL_MS',
      5 * 60 * 1000,
    );
    this.loginChallengeTtlMs = this.configService.get<number>(
      'WEBAUTHN_LOGIN_CHALLENGE_TTL_MS',
      5 * 60 * 1000,
    );
  }

  // ── Registration ─────────────────────────────────────────────────────────

  /**
   * Step 1 — Generate WebAuthn credential creation options for an
   * already-authenticated user, scoped to their wallet-linked account.
   */
  async beginRegistration(
    userId: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const existingCredentials = await this.credentialRepo.find({ where: { userId } });
    if (existingCredentials.length >= MAX_CREDENTIALS_PER_USER) {
      throw new BadRequestException(
        `Maximum of ${MAX_CREDENTIALS_PER_USER} passkeys per account reached. Remove one before adding another.`,
      );
    }

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.username,
      userDisplayName: user.displayName || user.username,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports as AuthenticatorTransportFuture[] | undefined,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.challengeStore.issue({
      type: ChallengeType.WEBAUTHN_REGISTRATION,
      key: userId,
      challenge: options.challenge,
      ttlMs: this.registrationChallengeTtlMs,
      userId,
    });

    return options;
  }

  /**
   * Step 2 — Verify the attestation response and persist the new passkey,
   * linked to the existing wallet-based user account.
   */
  async completeRegistration(
    userId: string,
    dto: VerifyRegistrationDto,
  ): Promise<{ id: string; deviceName?: string; createdAt: Date }> {
    // Atomically consumes the challenge: single-use, TTL-bound, and scoped
    // to this user, so a captured/replayed challenge cannot be redeemed
    // twice even under concurrent verification attempts.
    const { challenge } = await this.challengeStore.consume({
      type: ChallengeType.WEBAUTHN_REGISTRATION,
      key: userId,
      userId,
    });

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.attestationResponse as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
      });
    } catch (error) {
      throw new UnauthorizedException(
        `Passkey registration verification failed: ${(error as Error).message}`,
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('Passkey registration could not be verified.');
    }

    const { credential } = verification.registrationInfo;

    const existing = await this.credentialRepo.findOne({ where: { credentialId: credential.id } });
    if (existing) {
      throw new BadRequestException('This passkey is already registered.');
    }

    const record = this.credentialRepo.create({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports,
      deviceName: dto.deviceName,
    });

    const saved = await this.credentialRepo.save(record);
    this.logger.log(`Registered new passkey for user ${userId}: ${saved.id}`);

    return { id: saved.id, deviceName: saved.deviceName, createdAt: saved.createdAt };
  }

  // ── Login ────────────────────────────────────────────────────────────────

  /**
   * Step 1 — Generate an authentication challenge. When a username is
   * provided, scope the allowed credentials to that user's passkeys;
   * otherwise let the browser surface any discoverable passkey.
   */
  async beginLogin(
    dto: BeginWebauthnLoginDto,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    let user: User | undefined;
    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;

    if (dto.username) {
      try {
        user = await this.usersService.findByUsername(dto.username);
      } catch {
        user = undefined;
      }

      if (user) {
        const credentials = await this.credentialRepo.find({ where: { userId: user.id } });
        allowCredentials = credentials.map((cred) => ({
          id: cred.credentialId,
          transports: cred.transports as AuthenticatorTransportFuture[] | undefined,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
      allowCredentials,
    });

    // Key the challenge by the challenge value itself so discoverable
    // (userless) logins can still be resolved on verification.
    await this.challengeStore.issue({
      type: ChallengeType.WEBAUTHN_LOGIN,
      key: options.challenge,
      challenge: options.challenge,
      ttlMs: this.loginChallengeTtlMs,
      userId: user?.id,
    });

    return options;
  }

  /**
   * Step 2 — Verify the assertion response against the stored credential
   * and, on success, issue a token pair just like wallet-signature login.
   */
  async completeLogin(
    dto: VerifyWebauthnLoginDto,
    req?: { ip?: string; headers?: Record<string, unknown> },
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const assertionResponse = dto.assertionResponse as unknown as AuthenticationResponseJSON;
    const credentialId = assertionResponse?.id;

    if (!credentialId) {
      throw new BadRequestException('Malformed assertion response: missing credential id.');
    }

    const credential = await this.credentialRepo.findOne({ where: { credentialId } });
    if (!credential) {
      throw new UnauthorizedException('Unrecognized passkey.');
    }

    const clientDataChallenge = this.extractChallenge(assertionResponse);

    // Atomically consumes the challenge: single-use and TTL-bound, so a
    // captured assertion cannot be replayed and concurrent verification
    // attempts for the same challenge cannot both succeed.
    const { userId: boundUserId } = await this.challengeStore.consume({
      type: ChallengeType.WEBAUTHN_LOGIN,
      key: clientDataChallenge,
      challenge: clientDataChallenge,
    });

    // Defense in depth: if the login was scoped to a known username at
    // begin-time, the credential that ultimately signs the assertion must
    // belong to that same user.
    if (boundUserId && boundUserId !== credential.userId) {
      throw new UnauthorizedException('Passkey does not belong to the requested account.');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertionResponse,
        expectedChallenge: clientDataChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        credential: {
          id: credential.credentialId,
          publicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: Number(credential.counter),
          transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
        },
      });
    } catch (error) {
      throw new UnauthorizedException(
        `Passkey login verification failed: ${(error as Error).message}`,
      );
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Passkey login could not be verified.');
    }

    // Update counter (replay/clone detection) and last-used timestamp.
    credential.counter = verification.authenticationInfo.newCounter;
    credential.lastUsedAt = new Date();
    await this.credentialRepo.save(credential);

    const user = await this.usersService.findById(credential.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive or not found.');
    }

    return this.sessionManager.issueTokens(user.id, user.walletAddress || user.id, {
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      method: 'webauthn',
    });
  }

  // ── Credential management ───────────────────────────────────────────────

  async listCredentials(userId: string): Promise<WebauthnCredential[]> {
    return this.credentialRepo.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
  }

  async removeCredential(userId: string, credentialId: string): Promise<void> {
    const credential = await this.credentialRepo.findOne({
      where: { id: credentialId, userId },
    });
    if (!credential) {
      throw new NotFoundException('Passkey not found.');
    }
    await this.credentialRepo.remove(credential);
    this.logger.log(`Removed passkey ${credentialId} for user ${userId}`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private extractChallenge(response: AuthenticationResponseJSON): string {
    try {
      const clientDataJSON = Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8');
      const parsed = JSON.parse(clientDataJSON);
      if (!parsed.challenge) throw new Error('missing challenge');
      return parsed.challenge;
    } catch {
      throw new BadRequestException('Malformed assertion response: could not parse clientDataJSON.');
    }
  }
}
