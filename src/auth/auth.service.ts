
import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Keypair } from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private usersService: UsersService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) { }

    async generateChallenge(publicKey: string): Promise<{ message: string }> {
        const nonce = crypto.randomBytes(32).toString('hex');
        const message = `Sign this message to authenticate with StellarSwipe: ${nonce}`;

        // Store challenge in Redis with 5 min TTL
        await this.cacheManager.set(`auth_challenge:${publicKey}`, message, 300000); // 300s = 5m. Check if cache manager expects ms or s.

        return { message };
    }

    async verifySignature(dto: VerifySignatureDto): Promise<{ accessToken: string }> {
        const { publicKey, signature, message } = dto;

        // 1. Retrieve challenge from Redis
        const storedMessage = await this.cacheManager.get<string>(`auth_challenge:${publicKey}`);

        if (!storedMessage) {
            throw new UnauthorizedException('Challenge expired or not found. Please request a new challenge.');
        }

        if (storedMessage !== message) {
            throw new UnauthorizedException('Message mismatch. Please sign the correct challenge.');
        }

        // 2. Verify signature
        try {
            const keypair = Keypair.fromPublicKey(publicKey);
            const isValid = keypair.verify(Buffer.from(message), Buffer.from(signature, 'base64'));

            if (!isValid) {
                throw new UnauthorizedException('Invalid signature');
            }
        } catch (error) {
            throw new UnauthorizedException('Signature verification failed');
        }

        // 3. Clear challenge after successful verification (prevent replay)
        await this.cacheManager.del(`auth_challenge:${publicKey}`);

        // 4. Find or create user
        const user = await this.usersService.findOrCreateByWalletAddress(publicKey);

        // 5. Generate JWT using Internal User ID
        const payload: JwtPayload = { sub: user.id };
        const accessToken = this.jwtService.sign(payload);

        return { accessToken };
    }
}
