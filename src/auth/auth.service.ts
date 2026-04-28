
import { Injectable, Inject, UnauthorizedException, NotFoundException } from '@nestjs/common';
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
import { Request } from 'express';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private usersService: UsersService,
        private authAuditService: AuthAuditService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) { }

    async generateChallenge(publicKey: string): Promise<{ message: string }> {
        const nonce = crypto.randomBytes(32).toString('hex');
        const message = `Sign this message to authenticate with StellarSwipe: ${nonce}`;

        // Store challenge in Redis with 5 min TTL
        await this.cacheManager.set(`auth_challenge:${publicKey}`, message, 300000); // 300s = 5m. Check if cache manager expects ms or s.

        return { message };
    }

    async verifySignature(dto: VerifySignatureDto, req?: Request): Promise<{ accessToken: string }> {
        const { publicKey, signature, message } = dto;

        // 1. Retrieve challenge from Redis
        const storedMessage = await this.cacheManager.get<string>(`auth_challenge:${publicKey}`);

        if (!storedMessage) {
            if (req) await this.authAuditService.logLoginFailed(req, 'Challenge expired or not found');
            throw new UnauthorizedException('Challenge expired or not found. Please request a new challenge.');
        }

        if (storedMessage !== message) {
            if (req) await this.authAuditService.logLoginFailed(req, 'Message mismatch');
            throw new UnauthorizedException('Message mismatch. Please sign the correct challenge.');
        }

        // 2. Verify signature
        try {
            const keypair = Keypair.fromPublicKey(publicKey);
            const isValid = keypair.verify(Buffer.from(message), Buffer.from(signature, 'base64'));

            if (!isValid) {
                if (req) await this.authAuditService.logLoginFailed(req, 'Invalid signature');
                throw new UnauthorizedException('Invalid signature');
            }
        } catch (error) {
            if (req) await this.authAuditService.logLoginFailed(req, 'Signature verification failed');
            throw new UnauthorizedException('Signature verification failed');
        }

        // 3. Clear challenge after successful verification (prevent replay)
        await this.cacheManager.del(`auth_challenge:${publicKey}`);

        // 4. Find or create user
        const user = await this.usersService.findOrCreateByWalletAddress(publicKey);

        // 5. Generate JWT using Internal User ID
        const payload: JwtPayload = { sub: user.id };
        const accessToken = this.jwtService.sign(payload);

        if (req) await this.authAuditService.logLogin(user.id, req);

        return { accessToken };
    }

    async register(dto: RegisterDto): Promise<{ user: any; accessToken: string }> {
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

        try {
            const user = await this.usersService.findByEmail(email);

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
        } catch (error) {
            // We should not reveal if user exists or not for security reasons
            if (!(error instanceof NotFoundException)) {
                throw error;
            }
        }

        return { message: 'If an account with that email exists, a password reset link has been sent.' };
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
}
