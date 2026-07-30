import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  Headers,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ZapierService } from './zapier.service';
import { MakeService } from './make.service';
import { TriggerConfigDto } from './dto/trigger-config.dto';
import { ActionConfigDto, ActionType } from './dto/action-config.dto';
import { WebhookPayloadDto } from './dto/webhook-payload.dto';
import { SignalsService } from '../../signals/signals.service';
import { TradesService } from '../../trades/trades.service';
import { PortfolioService } from '../../portfolio/portfolio.service';
import { newSignalTrigger } from './triggers/new-signal.trigger';
import { tradeExecutedTrigger } from './triggers/trade-executed.trigger';
import { priceAlertTrigger } from './triggers/price-alert.trigger';
import { executeTradeAction } from './actions/execute-trade.action';
import { createSignalAction } from './actions/create-signal.action';
import { getPortfolioAction } from './actions/get-portfolio.action';
import { formatActionResponse } from './utils/payload-formatter';
import { WebhookVerifierService } from '../webhooks/webhook-verifier.service';

@Controller('api/v1/automation')
export class AutomationController {
  constructor(
    private readonly zapier: ZapierService,
    private readonly make: MakeService,
    private readonly signalsService: SignalsService,
    private readonly tradesService: TradesService,
    private readonly portfolioService: PortfolioService,
    private readonly webhookVerifier: WebhookVerifierService,
  ) {}

  @Get('triggers')
  getTriggers() {
    return [newSignalTrigger, tradeExecutedTrigger, priceAlertTrigger];
  }

  @Get('actions')
  getActions() {
    return [executeTradeAction, createSignalAction, getPortfolioAction];
  }

  // --- Zapier ---

  @Post('zapier/subscribe')
  subscribeZapier(@Body() dto: TriggerConfigDto & { userId: string }) {
    return this.zapier.subscribe(dto.userId, dto);
  }

  @Delete('zapier/unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribeZapier(
    @Query('userId') userId: string,
    @Query('event') event: string,
    @Query('hookUrl') hookUrl: string,
  ) {
    this.zapier.unsubscribe(userId, event, hookUrl);
  }

  // --- Make.com ---

  @Post('make/subscribe')
  subscribeMake(@Body() dto: TriggerConfigDto & { userId: string }) {
    return this.make.subscribe(dto.userId, dto);
  }

  @Delete('make/unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribeMake(
    @Query('userId') userId: string,
    @Query('event') event: string,
    @Query('hookUrl') hookUrl: string,
  ) {
    this.make.unsubscribe(userId, event, hookUrl);
  }

  // --- Inbound action webhook (called by Zapier/Make to trigger actions) ---

  @Post('action')
  async handleAction(
    @Body() dto: ActionConfigDto,
    @Headers('x-stellarswipe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.webhookVerifier.validateRequest({
      rawBody: req.rawBody,
      parsedBody: dto,
      signatureHeader: signature,
    });

    try {
      switch (dto.action) {
        case ActionType.GET_PORTFOLIO: {
          const data = await this.portfolioService.getPerformance(dto.userId);
          return formatActionResponse(true, data);
        }
        case ActionType.CREATE_SIGNAL: {
          const data = await this.signalsService.create({
            providerId: dto.userId,
            baseAsset: dto.symbol?.split('/')[0] ?? 'XLM',
            counterAsset: dto.symbol?.split('/')[1] ?? 'USDC',
          });
          return formatActionResponse(true, data);
        }
        case ActionType.EXECUTE_TRADE: {
          const data = await this.tradesService.executeTrade({
            userId: dto.userId,
            signalId: dto.signalId!,
            amount: dto.amount!,
            side: 'buy' as any,
            walletAddress: '',
          });
          return formatActionResponse(true, data);
        }
        default:
          return formatActionResponse(false, null, 'Unknown action');
      }
    } catch (err: any) {
      return formatActionResponse(false, null, err.message);
    }
  }

  // --- Inbound trigger webhook (for testing/manual dispatch) ---

  @Post('trigger/dispatch')
  async dispatchTrigger(
    @Body() dto: WebhookPayloadDto,
    @Headers('x-stellarswipe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    this.webhookVerifier.validateRequest({
      rawBody: req.rawBody,
      parsedBody: dto,
      signatureHeader: signature,
    });

    await Promise.all([
      this.zapier.dispatch(dto.userId, dto.event, dto.data),
      this.make.dispatch(dto.userId, dto.event, dto.data),
    ]);
    return { dispatched: true };
  }
}
