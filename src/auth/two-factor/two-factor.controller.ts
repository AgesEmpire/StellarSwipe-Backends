import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { TwoFactorService } from './two-factor.service';
import { Enable2faDto } from '../dto/enable-2fa.dto';
import { Verify2faDto } from '../dto/verify-2fa.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  RateLimit,
  RateLimitTier,
} from '../../common/decorators/rate-limit.decorator';

interface AuthenticatedRequest extends Request {
  user: { id: string; email: string };
}

@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  /**
   * GET /auth/2fa/status
   * Returns whether 2FA is currently enabled for the authenticated user.
   */
  @Get('status')
  async getStatus(@Req() req: AuthenticatedRequest) {
    const enabled = await this.twoFactorService.isEnabled(req.user.id);
    return { enabled };
  }

  /**
   * POST /auth/2fa/enroll
   * Step 1 of enrollment — generates TOTP secret and returns QR code.
   */
  @Post('enroll')
  @HttpCode(HttpStatus.OK)
  async initiateEnrollment(@Req() req: AuthenticatedRequest) {
    const { qrCodeDataUrl, manualEntryKey } =
      await this.twoFactorService.initiateEnrollment(
        req.user.id,
        req.user.email,
      );
    return {
      qrCodeDataUrl,
      manualEntryKey,
      message:
        'Scan the QR code with your authenticator app, then call POST /auth/2fa/enroll/confirm with a valid TOTP code.',
    };
  }

  /**
   * POST /auth/2fa/enroll/confirm
   * Step 2 of enrollment — verifies the first TOTP code and activates 2FA.
   * Returns one-time plaintext backup codes. User must store these securely.
   */
  @Post('enroll/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 5, window: 60 })
  async confirmEnrollment(
    @Req() req: AuthenticatedRequest,
    @Body() dto: Enable2faDto,
  ) {
    const { backupCodes } = await this.twoFactorService.confirmEnrollment(
      req.user.id,
      dto,
    );
    return {
      message:
        '2FA enabled successfully. Store your backup codes somewhere safe — they will not be shown again.',
      backupCodes,
    };
  }

  /**
   * POST /auth/2fa/verify
   * Verify a TOTP token or backup code. Called before sensitive actions
   * (payouts, settings changes, large trades > $1000).
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 5, window: 60 })
  async verify(@Req() req: AuthenticatedRequest, @Body() dto: Verify2faDto) {
    await this.twoFactorService.verify(req.user.id, dto);
    return { verified: true };
  }

  /**
   * DELETE /auth/2fa
   * Disable 2FA. Requires a valid TOTP token or backup code.
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 5, window: 60 })
  async disable(@Req() req: AuthenticatedRequest, @Body() dto: Verify2faDto) {
    await this.twoFactorService.disable(req.user.id, dto);
    return { message: '2FA has been disabled.' };
  }

  /**
   * POST /auth/2fa/backup-codes/regenerate
   * Regenerate backup codes. Requires a valid TOTP code (not a backup code
   * itself, to prevent a stolen backup code from cycling all codes).
   */
  @Post('backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 3, window: 3600 })
  async regenerateBackupCodes(
    @Req() req: AuthenticatedRequest,
    @Body() dto: Verify2faDto,
  ) {
    const { backupCodes } = await this.twoFactorService.regenerateBackupCodes(
      req.user.id,
      dto,
    );
    return {
      message: 'Backup codes regenerated. Previous codes are now invalid.',
      backupCodes,
    };
  }
}
