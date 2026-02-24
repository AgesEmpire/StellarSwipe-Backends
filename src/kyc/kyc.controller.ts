import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  RawBodyRequest,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';

import { KycService } from './kyc.service';
// import { KycProvider } from './entities/kyc-verification.entity';
import {
  StartKycDto,
  StartKycResponseDto,
  KycStatusDto,
  ManualReviewDto,
  ComplianceReportDto,
} from './dto/start-kyc.dto';

@ApiTags('KYC / Identity Verification')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // ─── User-facing endpoints ────────────────────────────────────────────────

  @Post('start')
  @ApiOperation({ summary: 'Initiate or resume a KYC verification flow' })
  @ApiResponse({ status: 201, type: StartKycResponseDto })
  startKyc(
    @Body() dto: StartKycDto,
    @Req() req: Request,
  ): Promise<StartKycResponseDto> {
    const userId = (req as any).user?.id;
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    return this.kycService.startKyc(userId, dto, ip);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get all KYC verifications for the authenticated user',
  })
  @ApiResponse({ status: 200, type: [KycStatusDto] })
  getMyStatus(@Req() req: Request): Promise<KycStatusDto[]> {
    const userId = (req as any).user?.id;
    return this.kycService.getUserKycStatus(userId);
  }

  @Get('level')
  @ApiOperation({
    summary: 'Get the current active KYC level for the authenticated user',
  })
  async getMyLevel(@Req() req: Request) {
    const userId = (req as any).user?.id;
    const level = await this.kycService.getActiveKycLevel(userId);
    return { level };
  }

  @Get('limits')
  @ApiOperation({ summary: 'Check current KYC limits and usage' })
  async getMyLimits(@Req() req: Request) {
    const userId = (req as any).user?.id;
    return this.kycService.checkMonthlyLimit(userId, 0);
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  /**
   * Persona webhook endpoint.
   *
   * Configure in Persona dashboard:
   *   URL: POST /kyc/webhooks/persona
   *   Events: inquiry.approved, inquiry.declined, inquiry.needs_review
   *
   * NOTE: This endpoint must be excluded from JWT auth and rate limiting.
   * The raw body must be accessible — ensure your NestJS app uses rawBody: true.
   */
  @Post('webhooks/persona')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Persona webhook receiver (no auth required)' })
  async personaWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('persona-signature') signature: string,
    @Body() payload: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody?.toString() ?? JSON.stringify(payload);
    await this.kycService.processPersonaWebhook(rawBody, signature, payload);
    return { received: true };
  }

  /**
   * Onfido webhook endpoint.
   *
   * Configure in Onfido dashboard:
   *   URL: POST /kyc/webhooks/onfido
   *   Events: workflow_run.completed
   */
  @Post('webhooks/onfido')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Onfido webhook receiver (no auth required)' })
  async onfidoWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-sha2-signature') signature: string,
    @Body() payload: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody?.toString() ?? JSON.stringify(payload);
    await this.kycService.processOnfidoWebhook(rawBody, signature, payload);
    return { received: true };
  }

  // ─── Admin endpoints ──────────────────────────────────────────────────────

  @Get('admin/user/:userId')
  @ApiOperation({ summary: '[Admin] Get all KYC verifications for a user' })
  adminGetUserKyc(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<KycStatusDto[]> {
    return this.kycService.getUserKycStatus(userId);
  }

  @Patch('admin/verification/:id/review')
  @ApiOperation({
    summary: '[Admin] Manually approve or reject a KYC verification',
  })
  manualReview(
    @Param('id', ParseUUIDPipe) verificationId: string,
    @Body() dto: ManualReviewDto,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    return this.kycService.manualReview(verificationId, dto, ip);
  }

  @Get('admin/compliance-report')
  @ApiOperation({ summary: '[Admin] Generate KYC compliance report' })
  @ApiResponse({ status: 200, type: ComplianceReportDto })
  complianceReport(): Promise<ComplianceReportDto> {
    return this.kycService.generateComplianceReport();
  }
}
