
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthChallengeDto } from './dto/auth-challenge.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { Audit } from '../audit-log/interceptors/audit-logging.interceptor';
import { AuditAction } from '../audit-log/entities/audit-log.entity';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({ status: 201, description: 'User successfully registered' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    async register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Request password reset link' })
    @ApiResponse({ status: 200, description: 'Reset link sent if user exists' })
    async forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.authService.forgotPassword(dto);
    }

    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reset password using token' })
    @ApiResponse({ status: 200, description: 'Password successfully reset' })
    @ApiResponse({ status: 401, description: 'Invalid or expired token' })
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto);
    }

    @Post('challenge')
    @HttpCode(HttpStatus.OK)
    @RateLimit({ tier: RateLimitTier.PUBLIC, limit: 20, window: 60 })
    async getChallenge(@Body() dto: AuthChallengeDto) {
        if (!dto.publicKey) {
            throw new Error('Public Key is required for now');
        }
        return this.authService.generateChallenge(dto.publicKey);
    }

    @Post('verify')
    @Audit({ action: AuditAction.LOGIN, resource: 'auth' })
    @HttpCode(HttpStatus.OK)
    @RateLimit({ tier: RateLimitTier.PUBLIC, limit: 10, window: 60 })
    async verify(@Body() dto: VerifySignatureDto) {
        return this.authService.verifySignature(dto);
    }
}
