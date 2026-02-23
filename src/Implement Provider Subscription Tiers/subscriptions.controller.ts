import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateTierDto, UpdateTierDto } from './dto/create-tier.dto';
import { SubscribeDto, CancelSubscriptionDto } from './dto/subscribe.dto';

/**
 * SubscriptionsController
 *
 * Endpoints:
 *
 * Provider (tier management)
 *   POST   /subscriptions/tiers                      – create tier
 *   GET    /subscriptions/tiers/provider/:providerId – list provider tiers
 *   PATCH  /subscriptions/tiers/:tierId              – update tier
 *
 * User (subscription management)
 *   POST   /subscriptions/subscribe                  – subscribe to tier
 *   POST   /subscriptions/cancel                     – cancel subscription
 *   PATCH  /subscriptions/:id/change-tier            – change to different tier
 *   GET    /subscriptions/me                         – list my subscriptions
 *   GET    /subscriptions/:id                        – get subscription detail
 *
 * Access control
 *   GET    /subscriptions/access-check               – check access to a provider's signals
 *
 * Revenue
 *   GET    /subscriptions/revenue/:providerId        – provider revenue report
 */
@Controller('subscriptions')
// @UseGuards(JwtAuthGuard) // Uncomment and attach your auth guard
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // ─── Tier endpoints ───────────────────────────────────────────────────────

  @Post('tiers')
  createTier(
    @Request() req: any,
    @Body() dto: CreateTierDto,
  ) {
    const providerId = req.user?.id ?? 'demo-provider'; // replace with real auth
    return this.subscriptionsService.createTier(providerId, dto);
  }

  @Get('tiers/provider/:providerId')
  getProviderTiers(@Param('providerId') providerId: string) {
    return this.subscriptionsService.getActiveTiers(providerId);
  }

  @Patch('tiers/:tierId')
  updateTier(
    @Request() req: any,
    @Param('tierId', ParseUUIDPipe) tierId: string,
    @Body() dto: UpdateTierDto,
  ) {
    const providerId = req.user?.id ?? 'demo-provider';
    return this.subscriptionsService.updateTier(providerId, tierId, dto);
  }

  // ─── Subscription endpoints ───────────────────────────────────────────────

  @Post('subscribe')
  subscribe(@Request() req: any, @Body() dto: SubscribeDto) {
    const userId = req.user?.id ?? 'demo-user';
    return this.subscriptionsService.subscribe(userId, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Request() req: any, @Body() dto: CancelSubscriptionDto) {
    const userId = req.user?.id ?? 'demo-user';
    return this.subscriptionsService.cancelSubscription(userId, dto);
  }

  @Patch(':subscriptionId/change-tier')
  changeTier(
    @Request() req: any,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body('newTierId', ParseUUIDPipe) newTierId: string,
  ) {
    const userId = req.user?.id ?? 'demo-user';
    return this.subscriptionsService.changeTier(userId, subscriptionId, newTierId);
  }

  @Get('me')
  getMySubscriptions(@Request() req: any) {
    const userId = req.user?.id ?? 'demo-user';
    return this.subscriptionsService.getUserSubscriptions(userId);
  }

  @Get(':subscriptionId')
  getSubscription(@Param('subscriptionId', ParseUUIDPipe) subscriptionId: string) {
    return this.subscriptionsService.getSubscription(subscriptionId);
  }

  // ─── Access control ───────────────────────────────────────────────────────

  @Get('access-check')
  checkAccess(
    @Request() req: any,
    @Query('providerId') providerId: string,
    @Query('tierId') tierId?: string,
  ) {
    const userId = req.user?.id ?? 'demo-user';
    return this.subscriptionsService.checkAccess({ userId, providerId, requiredTierId: tierId });
  }

  // ─── Revenue ──────────────────────────────────────────────────────────────

  @Get('revenue/:providerId')
  getProviderRevenue(@Param('providerId') providerId: string) {
    return this.subscriptionsService.getProviderRevenue(providerId);
  }
}
