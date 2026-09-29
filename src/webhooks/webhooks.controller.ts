import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';
import {
  RegisterWebhookDto,
  UpdateWebhookDto,
  SUPPORTED_WEBHOOK_EVENTS,
  MANDATORY_WEBHOOK_EVENTS,
} from './dto/register-webhook.dto';
import { VerifyWebhookEndpointDto } from './dto/verify-webhook-endpoint.dto';
import { toWebhookResponse } from './dto/webhook-response.dto';

@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  async register(@Request() req: { user: { id: string } }, @Body() dto: RegisterWebhookDto) {
    const webhook = await this.webhooksService.register(req.user.id, dto);
    return toWebhookResponse(webhook, { secret: true });
  }

  @Get()
  async findAll(@Request() req: { user: { id: string } }) {
    const webhooks = await this.webhooksService.findAllForUser(req.user.id);
    return webhooks.map((webhook) => toWebhookResponse(webhook));
  }

  @Get('events')
  getSupportedEvents() {
    return {
      events: SUPPORTED_WEBHOOK_EVENTS,
      mandatoryEvents: MANDATORY_WEBHOOK_EVENTS,
    };
  }

  @Get(':id')
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return toWebhookResponse(
      await this.webhooksService.findOne(req.user.id, id),
    );
  }

  @Patch(':id')
  async update(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return toWebhookResponse(
      await this.webhooksService.update(req.user.id, id, dto),
    );
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  verifyEndpoint(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyWebhookEndpointDto,
  ) {
    return this.webhooksService.verifyEndpoint(req.user.id, id, dto.token);
  }

  @Post(':id/verify/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  resendEndpointVerification(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.resendEndpointVerification(req.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.remove(req.user.id, id);
  }

  @Get(':id/deliveries')
  getDeliveries(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.webhooksService.getDeliveries(req.user.id, id, limit, offset);
  }

  @Post('deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retryDelivery(
    @Request() req: { user: { id: string } },
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooksService.retryDelivery(req.user.id, deliveryId);
  }

  @Post('deliveries/:deliveryId/replay/:webhookId')
  @HttpCode(HttpStatus.ACCEPTED)
  replayToSubscriber(
    @Request() req: { user: { id: string } },
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Param('webhookId', ParseUUIDPipe) webhookId: string,
  ) {
    return this.webhooksService.replayToSubscriber(req.user.id, deliveryId, webhookId);
  }

  @Get(':id/replays')
  getReplays(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.webhooksService.getReplayAudits(req.user.id, id, limit, offset);
  }

  @Post(':id/secret-rotation/initiate')
  @HttpCode(HttpStatus.OK)
  async initiateSecretRotation(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Query('rotationWindowMs', new DefaultValuePipe(3600000), ParseIntPipe) rotationWindowMs: number,
  ) {
    const webhook = await this.webhooksService.initiateSecretRotation(
      req.user.id,
      id,
      rotationWindowMs,
    );
    return toWebhookResponse(webhook, { nextSecret: true });
  }

  @Post(':id/secret-rotation/finalize')
  @HttpCode(HttpStatus.OK)
  async finalizeSecretRotation(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return toWebhookResponse(
      await this.webhooksService.finalizeSecretRotation(req.user.id, id),
    );
  }
}
