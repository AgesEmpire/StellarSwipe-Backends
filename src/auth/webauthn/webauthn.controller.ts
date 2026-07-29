import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { WebauthnService } from './webauthn.service';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';
import { BeginWebauthnLoginDto } from './dto/begin-login.dto';
import { VerifyWebauthnLoginDto } from './dto/verify-login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { Audit } from '../../audit-log/interceptors/audit-logging.interceptor';
import { AuditAction } from '../../audit-log/entities/audit-log.entity';
import { RateLimit, RateLimitTier } from '../../common/decorators/rate-limit.decorator';

interface AuthenticatedRequest extends Request {
  user: { id: string; userId: string };
}

@ApiTags('auth')
@Controller('auth/webauthn')
export class WebauthnController {
  constructor(private readonly webauthnService: WebauthnService) {}

  /**
   * POST /auth/webauthn/register/begin
   * Step 1 of passkey registration for an already-authenticated user.
   * Requires a valid JWT (wallet-signature login or an existing passkey).
   */
  @Post('register/begin')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Begin WebAuthn passkey registration' })
  @ApiResponse({ status: 200, description: 'Credential creation options' })
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 10, window: 60 })
  async beginRegistration(@Req() req: AuthenticatedRequest) {
    return this.webauthnService.beginRegistration(req.user.id);
  }

  /**
   * POST /auth/webauthn/register/complete
   * Step 2 of passkey registration — verifies the attestation response and
   * links the new credential to the authenticated user's account.
   */
  @Post('register/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete WebAuthn passkey registration' })
  @ApiResponse({ status: 201, description: 'Passkey registered' })
  @ApiResponse({ status: 401, description: 'Attestation verification failed' })
  @Audit({ action: AuditAction.SETTINGS_UPDATED, resource: 'webauthn_credential' })
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 10, window: 60 })
  async completeRegistration(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyRegistrationDto,
  ) {
    return this.webauthnService.completeRegistration(req.user.id, dto);
  }

  /**
   * GET /auth/webauthn/credentials
   * List the authenticated user's registered passkeys.
   */
  @Get('credentials')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List registered passkeys for the authenticated user' })
  async listCredentials(@Req() req: AuthenticatedRequest) {
    const credentials = await this.webauthnService.listCredentials(req.user.id);
    return credentials.map((cred) => ({
      id: cred.id,
      deviceName: cred.deviceName,
      transports: cred.transports,
      lastUsedAt: cred.lastUsedAt,
      createdAt: cred.createdAt,
    }));
  }

  /**
   * DELETE /auth/webauthn/credentials/:id
   * Remove a single registered passkey from the authenticated user's account.
   */
  @Delete('credentials/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a registered passkey' })
  @ApiResponse({ status: 200, description: 'Passkey removed' })
  @ApiResponse({ status: 404, description: 'Passkey not found' })
  @Audit({ action: AuditAction.SETTINGS_UPDATED, resource: 'webauthn_credential' })
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 10, window: 60 })
  async removeCredential(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.webauthnService.removeCredential(req.user.id, id);
    return { message: 'Passkey removed.' };
  }

  /**
   * POST /auth/webauthn/login/begin
   * Step 1 of passkey login — generates an authentication challenge.
   * Public endpoint (no JWT required) since the user is not yet logged in.
   */
  @Post('login/begin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Begin WebAuthn passkey login' })
  @ApiResponse({ status: 200, description: 'Authentication challenge options' })
  @RateLimit({ tier: RateLimitTier.AUTH, limit: 20, window: 60, keyBy: ['username'], accountLimit: 10, accountWindow: 60 })
  async beginLogin(@Body() dto: BeginWebauthnLoginDto) {
    return this.webauthnService.beginLogin(dto);
  }

  /**
   * POST /auth/webauthn/login/complete
   * Step 2 of passkey login — verifies the assertion response and, on
   * success, issues a token pair for the linked user account.
   */
  @Post('login/complete')
  @HttpCode(HttpStatus.OK)
  @Audit({ action: AuditAction.LOGIN, resource: 'auth' })
  @ApiOperation({ summary: 'Complete WebAuthn passkey login' })
  @ApiResponse({ status: 200, description: 'Token pair issued' })
  @ApiResponse({ status: 401, description: 'Assertion verification failed' })
  @RateLimit({ tier: RateLimitTier.AUTH, limit: 10, window: 60, accountLimit: 5, accountWindow: 300 })
  async completeLogin(@Body() dto: VerifyWebauthnLoginDto, @Req() req: Request) {
    return this.webauthnService.completeLogin(dto, req);
  }
}
