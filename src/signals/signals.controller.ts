import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
  HttpException,
  UseGuards,
  UseInterceptors,
  Request,
  Req,
} from '@nestjs/common';
import { SignalsService } from './signals.service';
import { PremiumSignalService } from './premium-signal.service';
import {
  SubscribePremiumDto,
  UpdatePremiumSignalDto,
} from './dto/premium-signal.dto';
import { Signal } from './entities/signal.entity';
import { I18nAppService } from '../i18n/i18n.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSignalDto, PaginatedSignalsQueryDto } from './dto';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RequireIdempotencyKeyGuard } from '../common/guards/require-idempotency-key.guard';
import { RequireScopes } from '../api-keys/decorators/require-scopes.decorator';
import { ApiKeyScope } from '../api-keys/enums/api-key-scope.enum';

@Controller('signals')
@UseInterceptors(IdempotencyInterceptor)
export class SignalsController {
  constructor(
    private readonly signalsService: SignalsService,
    private readonly premiumSignalService: PremiumSignalService,
    private readonly i18n: I18nAppService,
  ) {}

  /**
   * POST /signals
   *
   * Create a new signal. Requires an Idempotency-Key header to prevent
   * duplicate signal creation on network retries.
   * Returns 400 if the header is missing, 409 if a concurrent duplicate is detected.
   *
   * Issue #861 — idempotency key support
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RequireIdempotencyKeyGuard)
  @RequireScopes(ApiKeyScope.SIGNALS_WRITE)
  async createSignal(
    @Body() body: CreateSignalDto,
    @Req() req: any,
  ): Promise<Signal> {
    try {
      return await this.signalsService.create(body);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const lang = req['language'] || 'en';
      let errorMessage = 'Trade execution failed';

      if (error instanceof Error) {
        if (error.message.includes('price')) {
          errorMessage = await this.i18n.translate(
            'errors.INVALID_PRICE',
            lang,
          );
        } else if (error.message.includes('balance')) {
          errorMessage = await this.i18n.translate(
            'errors.INSUFFICIENT_BALCHASE',
            lang,
          );
        } else {
          errorMessage = await this.i18n.translate('errors.TRADE_FAILED', lang);
        }
      }

      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * GET /signals
   *
   * Paginated signal feed. Supports both cursor-based and offset pagination.
   *
   * Cursor-based: GET /signals?after=<cursor>&limit=20
   * Offset-based: GET /signals?page=1&limit=20  (backward compatible)
   *
   * Issue #991 — cursor-based pagination for signals feed
   */
  @Get()
  @RequireScopes(ApiKeyScope.SIGNALS_READ)
  async findAll(@Query() query: PaginatedSignalsQueryDto) {
    return this.signalsService.findAll(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @RequireScopes(ApiKeyScope.SIGNALS_READ)
  async getSignal(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<Partial<Signal>> {
    const signal = await this.premiumSignalService.getSignalForUser(
      id,
      req.user.id,
    );
    if (!signal) throw new NotFoundException(`Signal with ID ${id} not found`);
    return signal;
  }

  @Get('feed/premium')
  @UseGuards(JwtAuthGuard)
  @RequireScopes(ApiKeyScope.SIGNALS_READ)
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
    return this.premiumSignalService.updateSignalPremiumStatus(
      id,
      req.user.id,
      dto,
    );
  }
}
