import {
  Injectable,
  Logger,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Keypair } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import { SessionManagerService } from '../auth/session/session-manager.service';
import { UsersService } from '../users/users.service';
import {
  FreighterChallengeDto,
  FreighterVerifyDto,
  FreighterActionDto,
} from './dto/freighter.dto';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CHALLENGE_PREFIX = 'freighter_challenge:';

@Injectable()
export class FreighterService {
  private readonly logger = new Logger(FreighterService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly sessionManager: SessionManagerService,
    private readonly usersService: UsersService,
  ) {}

  async issueChallenge(dto: FreighterChallengeDto): Promise<{ challenge: string }> {
    this.validatePublicKey(dto.publicKey);

    const nonce = crypto.randomBytes(32).toString('hex');
    const challenge = `StellarSwipe Freighter Auth: ${nonce}`;

    await this.cache.set(
      `${CHALLENGE_PREFIX}${dto.publicKey}`,
      challenge,
      CHALLENGE_TTL_MS,
    );

    this.logger.log(`Challenge issued for Freighter wallet ${dto.publicKey}`);
    return { challenge };
  }

  async verifyAndCreateSession(
    dto: FreighterVerifyDto,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    this.validatePublicKey(dto.publicKey);

    const stored = await this.cache.get<string>(
      `${CHALLENGE_PREFIX}${dto.publicKey}`,
    );

    if (!stored) {
      throw new UnauthorizedException(
        'Challenge expired or not found. Request a new challenge.',
      );
    }

    if (stored !== dto.challenge) {
      throw new UnauthorizedException('Challenge mismatch.');
    }

    this.verifySignature(dto.publicKey, dto.challenge, dto.signature);

    // One-time use — delete after successful verification
    await this.cache.del(`${CHALLENGE_PREFIX}${dto.publicKey}`);

    const user = await this.usersService.findOrCreateByWalletAddress(dto.publicKey);

    const tokens = await this.sessionManager.issueTokens(
      user.id,
      dto.publicKey,
      { walletProvider: 'freighter', ...meta },
    );

    this.logger.log(`Freighter session created for ${dto.publicKey}`);
    return tokens;
  }

  async validateSensitiveAction(dto: FreighterActionDto): Promise<{ valid: boolean }> {
    this.validatePublicKey(dto.publicKey);
    this.verifySignature(dto.publicKey, dto.payload, dto.signature);
    return { valid: true };
  }

  async revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
    await this.sessionManager.deleteSession(sessionId);
    this.logger.log(`Freighter session revoked: ${sessionId}`);
    return { revoked: true };
  }

  private verifySignature(publicKey: string, message: string, signature: string): void {
    try {
      const keypair = Keypair.fromPublicKey(publicKey);
      const valid = keypair.verify(
        Buffer.from(message),
        Buffer.from(signature, 'base64'),
      );
      if (!valid) throw new UnauthorizedException('Invalid Freighter signature.');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Signature verification failed.');
    }
  }

  private validatePublicKey(publicKey: string): void {
    try {
      Keypair.fromPublicKey(publicKey);
    } catch {
      throw new UnauthorizedException('Invalid Stellar public key.');
    }
  }
}
