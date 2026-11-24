import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { verifyRotatingHmacSignature } from '../../integrations/webhooks/utils/signature-validator';
import { NotificationReceiptService } from './notification-receipt.service';
import { parseSendGridEvents, ProviderReceiptEvent } from './provider-receipts';

const RECEIPT_PARSERS = new Map<string, (body: unknown) => ProviderReceiptEvent[]>([
  ['sendgrid', parseSendGridEvents],
]);

/**
 * Inbound provider delivery receipts. No JWT: authenticity comes from an HMAC
 * over the raw body, signed with NOTIFICATION_RECEIPT_WEBHOOK_SECRET (comma-separate
 * to rotate). Replays are harmless because receipts are deduped per event id.
 */
@ApiTags('notifications')
@Controller('notifications/receipts')
export class NotificationReceiptController {
  private readonly logger = new Logger(NotificationReceiptController.name);

  constructor(
    private readonly receiptService: NotificationReceiptService,
    private readonly config: ConfigService,
  ) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider delivery receipt webhook (HMAC-authenticated, no JWT)' })
  async receive(
    @Param('provider') provider: string,
    @Headers('x-notification-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody?.toString('utf8');
    const secrets = (this.config.get<string>('NOTIFICATION_RECEIPT_WEBHOOK_SECRET') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Fail closed when no secret is configured.
    if (!rawBody || secrets.length === 0) {
      this.logger.error('Notification receipt rejected: payload or NOTIFICATION_RECEIPT_WEBHOOK_SECRET missing');
      throw new UnauthorizedException('Invalid receipt signature');
    }
    if (!verifyRotatingHmacSignature(rawBody, signature, secrets).valid) {
      this.logger.warn(`Notification receipt for ${provider} failed signature verification`);
      throw new UnauthorizedException('Invalid receipt signature');
    }

    const parse = RECEIPT_PARSERS.get(provider);
    if (!parse) {
      throw new NotFoundException(`Unsupported receipt provider: ${provider}`);
    }

    await this.receiptService.ingest(provider, parse(body));
    return { received: true };
  }
}
