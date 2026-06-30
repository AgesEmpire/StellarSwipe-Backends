
import { Controller, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SessionManagerService } from './session/session-manager.service';
import { AuthChallengeDto } from './dto/auth-challenge.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { Audit } from '../audit-log/interceptors/audit-logging.interceptor';
import { AuditAction } from '../audit-log/entities/audit-log.entity';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';
import { Request } from 'express';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly sessionManager: SessionManagerService,
    ) { }

    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({ status: 201, description: 'User successfully registered' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    @ApiResponse({ status: 429, description: 'Too many registration attempts — see Retry-After header' })
    @RateLimit({ tier: RateLimitTier.AUTH, limit: 5, window: 60, keyBy: ['email'], accountLimit: 3, accountWindow: 300 })
    async register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Request password reset link' })
    @ApiResponse({ status: 200, description: 'Reset link sent if user exists' })
    @ApiResponse({ status: 429, description: 'Too many requests — see Retry-After header' })
    @RateLimit({ tier: RateLimitTier.AUTH, limit: 5, window: 60, keyBy: ['email'], accountLimit: 3, accountWindow: 3600 })
    async forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.authService.forgotPassword(dto);
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reset password using token' })
    @ApiResponse({ status: 200, description: 'Password successfully reset' })
    @ApiResponse({ status: 401, description: 'Invalid or expired token' })
    @ApiResponse({ status: 429, description: 'Too many attempts — see Retry-After header' })
    @RateLimit({ tier: RateLimitTier.AUTH, limit: 5, window: 60, keyBy: ['token'], accountLimit: 5, accountWindow: 300 })
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto);
    }

    @Post('challenge')
    @HttpCode(HttpStatus.OK)
    @RateLimit({ tier: RateLimitTier.AUTH, limit: 20, window: 60, keyBy: ['publicKey'], accountLimit: 10, accountWindow: 60 })
    async getChallenge(@Body() dto: AuthChallengeDto) {
        if (!dto.publicKey) {
            throw new Error('Public Key is required for now');
        }
        return this.authService.generateChallenge(dto.publicKey);
    }

    @Post('verify')
    @Audit({ action: AuditAction.LOGIN, resource: 'auth' })
    @HttpCode(HttpStatus.OK)
    @RateLimit({ tier: RateLimitTier.AUTH, limit: 10, window: 60, keyBy: ['publicKey'], accountLimit: 5, accountWindow: 300 })
    async verify(@Body() dto: VerifySignatureDto, @Req() req: Request) {
        return this.authService.verifySignature(dto, req);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token using a refresh token' })
    @ApiResponse({ status: 200, description: 'New token pair issued' })
    @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
    @RateLimit({ tier: RateLimitTier.AUTH, limit: 20, window: 60 })
    async refresh(@Body('refreshToken') refreshToken: string) {
        return this.sessionManager.refreshTokens(refreshToken);
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Revoke the current session' })
    @ApiResponse({ status: 200, description: 'Session revoked' })
    async logout(@Req() req: Request) {
        const sessionId: string | undefined = (req as any).user?.sessionId;
        if (sessionId) await this.sessionManager.deleteSession(sessionId);
        return { message: 'Logged out' };
    }

    @Post('logout-all')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Revoke all sessions for the authenticated user' })
    @ApiResponse({ status: 200, description: 'All sessions revoked' })
    async logoutAll(@Req() req: Request) {
        const userId: string | undefined = (req as any).user?.id;
        if (userId) await this.sessionManager.deleteAllUserSessions(userId);
        return { message: 'All sessions revoked' };
    }
}
