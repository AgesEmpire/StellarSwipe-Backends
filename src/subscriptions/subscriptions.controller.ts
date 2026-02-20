import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { AccessControlService } from './services/access-control.service';
import { CreateTierDto, UpdateTierDto } from './dto/create-tier.dto';
import {
  SubscribeDto,
  CancelSubscriptionDto,
  RenewSubscriptionDto,
} from './dto/subscribe.dto';

/**
 * SubscriptionsController
 *
 * Auth guard integration note:
 *   In production wire a real JWT guard and extract userId / walletAddress
 *   from the authenticated request object.  For now, walletAddress is
 *   accepted as a query param so the API can be exercised without auth.
 *
 * Routes:
 *   Tier management  (provider)
 *     POST   /subscriptions/tiers
 *     GET    /subscriptions/tiers/provider/:providerId
 *     GET    /subscriptions/tiers/:tierId
 *     PATCH  /subscriptions/tiers/:tierId
 *     DELETE /subscriptions/tiers/:tierId
 *
 *   Subscription management  (subscriber)
 *     POST   /subscriptions/subscribe
 *     GET    /subscriptions/my/:userId
 *     GET    /subscriptions/:subscriptionId
 *     PATCH  /subscriptions/:subscriptionId/cancel
 *     PATCH  /subscriptions/:subscriptionId/renew
 *
 *   Access control
 *     GET    /subscriptions/access/:userId/:providerId
 *
 *   Revenue
 *     GET    /subscriptions/revenue/:providerId
 */
@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly accessControl: AccessControlService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  TIER MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  @Post('tiers')
  @ApiOperation({ summary: 'Provider creates a new subscription tier' })
  @ApiResponse({ status: 201, description: 'Tier created successfully' })
  @ApiQuery({ name: 'providerId', description: 'UUID of the provider (user)' })
  @ApiQuery({ name: 'providerWallet', description: 'Provider Stellar wallet address' })
  async createTier(
    @Query('providerId') providerId: string,
    @Query('providerWallet') providerWallet: string,
    @Body() dto: CreateTierDto,
  ) {
    return this.subscriptionsService.createTier(providerId, providerWallet, dto);
  }

  @Get('tiers/provider/:providerId')
  @ApiOperation({ summary: 'Get all tiers created by a provider' })
  @ApiParam({ name: 'providerId', description: 'Provider UUID' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  async getProviderTiers(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.subscriptionsService.getProviderTiers(
      providerId,
      includeInactive === 'true',
    );
  }

  @Get('tiers/:tierId')
  @ApiOperation({ summary: 'Get a single subscription tier' })
  @ApiParam({ name: 'tierId', description: 'Tier UUID' })
  async getTier(@Param('tierId', ParseUUIDPipe) tierId: string) {
    return this.subscriptionsService.getTier(tierId);
  }

  @Patch('tiers/:tierId')
  @ApiOperation({ summary: 'Provider updates a subscription tier' })
  @ApiParam({ name: 'tierId' })
  @ApiQuery({ name: 'providerId', description: 'Provider UUID (auth stub)' })
  async updateTier(
    @Param('tierId', ParseUUIDPipe) tierId: string,
    @Query('providerId') providerId: string,
    @Body() dto: UpdateTierDto,
  ) {
    return this.subscriptionsService.updateTier(tierId, providerId, dto);
  }

  @Delete('tiers/:tierId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Provider cancels a tier and revokes subscriber access' })
  @ApiParam({ name: 'tierId' })
  @ApiQuery({ name: 'providerId', description: 'Provider UUID (auth stub)' })
  async cancelTier(
    @Param('tierId', ParseUUIDPipe) tierId: string,
    @Query('providerId') providerId: string,
  ) {
    await this.subscriptionsService.cancelTier(tierId, providerId);
  }

  // ─────────────────────────────────────────────────────────────
  //  SUBSCRIPTION MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Subscribe a user to a tier (provide Stellar USDC tx hash as proof of payment)',
  })
  @ApiResponse({ status: 201, description: 'Subscription activated' })
  @ApiQuery({ name: 'userId', description: 'Subscriber user UUID (auth stub)' })
  async subscribe(
    @Query('userId') userId: string,
    @Body() dto: SubscribeDto,
  ) {
    return this.subscriptionsService.subscribe(userId, dto);
  }

  @Get('my/:userId')
  @ApiOperation({ summary: "Get user's subscriptions" })
  @ApiParam({ name: 'userId' })
  async getUserSubscriptions(
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.subscriptionsService.getUserSubscriptions(userId);
  }

  @Get(':subscriptionId')
  @ApiOperation({ summary: 'Get a single subscription by ID' })
  @ApiParam({ name: 'subscriptionId' })
  @ApiQuery({ name: 'userId', required: false, description: 'Pass to enforce ownership check' })
  async getSubscription(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Query('userId') userId?: string,
  ) {
    return this.subscriptionsService.getSubscriptionById(subscriptionId, userId);
  }

  @Patch(':subscriptionId/cancel')
  @ApiOperation({ summary: 'Cancel a subscription' })
  @ApiParam({ name: 'subscriptionId' })
  @ApiQuery({ name: 'userId', description: 'Subscriber UUID (auth stub)' })
  async cancelSubscription(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Query('userId') userId: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptionsService.cancelSubscription(subscriptionId, userId, dto);
  }

  @Patch(':subscriptionId/renew')
  @ApiOperation({ summary: 'Manually renew a subscription by providing a new payment tx hash' })
  @ApiParam({ name: 'subscriptionId' })
  async renewSubscription(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: RenewSubscriptionDto,
  ) {
    return this.subscriptionsService.renewSubscription(subscriptionId, dto);
  }

  // ─────────────────────────────────────────────────────────────
  //  ACCESS CONTROL
  // ─────────────────────────────────────────────────────────────

  @Get('access/:userId/:providerId')
  @ApiOperation({ summary: "Check if a user has active access to a provider's signals" })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'providerId' })
  async checkAccess(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.accessControl.checkAccess(userId, providerId);
  }

  @Get('access/:userId/:providerId/signal')
  @ApiOperation({ summary: 'Check if a user can view a specific-tier signal' })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'providerId' })
  @ApiQuery({ name: 'tierLevel', required: false, description: 'Tier level of the signal (FREE, BASIC, PREMIUM)' })
  async checkSignalAccess(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query('tierLevel') tierLevel?: string,
  ) {
    return this.accessControl.canUserViewSignal(userId, providerId, tierLevel);
  }

  // ─────────────────────────────────────────────────────────────
  //  REVENUE
  // ─────────────────────────────────────────────────────────────

  @Get('revenue/:providerId')
  @ApiOperation({ summary: "Get a provider's revenue summary across all subscription tiers" })
  @ApiParam({ name: 'providerId' })
  async getRevenueSummary(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.subscriptionsService.getProviderRevenueSummary(providerId);
  }

  @Get('subscribers/:providerId')
  @ApiOperation({ summary: "List a provider's active subscribers" })
  @ApiParam({ name: 'providerId' })
  async getProviderSubscribers(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.accessControl.getActiveSubscribersForProvider(providerId);
  }
}
