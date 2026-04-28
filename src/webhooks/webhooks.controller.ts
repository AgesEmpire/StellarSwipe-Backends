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
import { RegisterWebhookDto, UpdateWebhookDto, SUPPORTED_WEBHOOK_EVENTS } from './dto/register-webhook.dto';

@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  register(@Request() req: { user: { id: string } }, @Body() dto: RegisterWebhookDto) {
    return this.webhooksService.register(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: { user: { id: string } }) {
    return this.webhooksService.findAllForUser(req.user.id);
  }

  @Get('events')
  getSupportedEvents() {
    return { events: SUPPORTED_WEBHOOK_EVENTS };
  }

  @Get(':id')
  findOne(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.webhooksService.findOne(req.user.id, id);
  }

  @Patch(':id')
  update(
    @Request() req: { user: { id: string } },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(req.user.id, id, dto);
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
}
