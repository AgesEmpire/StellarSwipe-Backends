
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthChallengeDto } from './dto/auth-challenge.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { Audit } from '../audit-log/interceptors/audit-logging.interceptor';
import { AuditAction } from '../audit-log/entities/audit-log.entity';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

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
