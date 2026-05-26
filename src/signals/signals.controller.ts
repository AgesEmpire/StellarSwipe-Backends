import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
  UseGuards,
  Request,
  Req,
} from '@nestjs/common';
import { SignalsService } from './signals.service';
import { PremiumSignalService } from './premium-signal.service';
import { SubscribePremiumDto, UpdatePremiumSignalDto } from './dto/premium-signal.dto';
import { Signal } from './entities/signal.entity';
import { I18nAppService } from '../i18n/i18n.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('signals')
export class SignalsController {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly premiumSignalService: PremiumSignalService,
    private readonly i18n: I18nAppService,
  ) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSignal(@Body() body: any, @Req() req: any): Promise<Signal> {
    try {
      return await this.signalsService.create(body);
    } catch (error) {
      const lang = req['language'] || 'en';
      let errorMessage = 'Trade execution failed';

      if (error instanceof Error) {
        if (error.message.includes('price')) {
          errorMessage = await this.i18n.translate('errors.INVALID_PRICE', lang);
        } else if (error.message.includes('balance')) {
          errorMessage = await this.i18n.translate('errors.INSUFFICIENT_BALANCE', lang);
        } else {
          errorMessage = await this.i18n.translate('errors.TRADE_FAILED', lang);
        }
      }

      throw new BadRequestException(errorMessage);
    }
  }

  @Get()
  async findAll(): Promise<Signal[]> {
    return this.signalsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getSignal(@Param('id', ParseUUIDPipe) id: string, @Request() req: any): Promise<Partial<Signal>> {
    const signal = await this.premiumSignalService.getSignalForUser(id, req.user.id);
    if (!signal) throw new NotFoundException(`Signal with ID ${id} not found`);
    return signal;
  }

  @Get('feed/premium')
  @UseGuards(JwtAuthGuard)
  getPremiumFeed(@Request() req: any) {
    return this.premiumSignalService.getFeedForUser(req.user.id);
  }

  @Post('premium/subscribe')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  subscribe(@Body() dto: SubscribePremiumDto, @Request() req: any) {
    return this.premiumSignalService.subscribe(req.user.id, dto);
  }

  @Get('premium/subscriptions')
  @UseGuards(JwtAuthGuard)
  getSubscriptions(@Request() req: any) {
    return this.premiumSignalService.getSubscriptions(req.user.id);
  }

  @Patch(':id/premium')
  @UseGuards(JwtAuthGuard)
  updatePremium(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePremiumSignalDto,
    @Request() req: any,
  ) {
    return this.premiumSignalService.updateSignalPremiumStatus(id, req.user.id, dto);
  }
}
