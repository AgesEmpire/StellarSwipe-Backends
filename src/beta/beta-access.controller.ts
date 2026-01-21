import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BetaAccessService } from './beta-access.service';
import {
  CreateInviteCodeDto,
  GenerateBulkInviteCodesDto,
  ValidateInviteCodeDto,
  RegisterBetaUserDto,
  UpdateBetaUserDto,
  JoinWaitlistDto,
  BulkInviteFromWaitlistDto,
  CreateFeedbackDto,
  PaginationQueryDto,
} from './dto';
import { FeedbackStatus } from './entities/feedback.entity';

@Controller('beta')
export class BetaAccessController {
  constructor(private readonly betaAccessService: BetaAccessService) {}

  // ============ INVITE CODE ENDPOINTS ============

  @Post('invite-codes')
  async createInviteCode(@Body() dto: CreateInviteCodeDto) {
    return this.betaAccessService.createInviteCode(dto);
  }

  @Post('invite-codes/bulk')
  async generateBulkInviteCodes(@Body() dto: GenerateBulkInviteCodesDto) {
    return this.betaAccessService.generateBulkInviteCodes(dto);
  }

  @Post('invite-codes/validate')
  @HttpCode(HttpStatus.OK)
  async validateInviteCode(@Body() dto: ValidateInviteCodeDto) {
    return this.betaAccessService.validateInviteCode(dto.code);
  }

  @Get('invite-codes')
  async listInviteCodes(@Query() query: PaginationQueryDto) {
    return this.betaAccessService.listInviteCodes(query);
  }

  @Get('invite-codes/:id')
  async getInviteCode(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.getInviteCode(id);
  }

  @Delete('invite-codes/:id')
  async revokeInviteCode(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.revokeInviteCode(id);
  }

  // ============ BETA USER ENDPOINTS ============

  @Post('users/register')
  async registerBetaUser(@Body() dto: RegisterBetaUserDto) {
    return this.betaAccessService.registerBetaUser(dto);
  }

  @Get('users')
  async listBetaUsers(@Query() query: PaginationQueryDto) {
    return this.betaAccessService.listBetaUsers(query);
  }

  @Get('users/:id')
  async getBetaUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.getBetaUser(id);
  }

  @Put('users/:id')
  async updateBetaUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBetaUserDto,
  ) {
    return this.betaAccessService.updateBetaUser(id, dto);
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspendBetaUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.suspendBetaUser(id);
  }

  @Post('users/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeBetaUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.revokeBetaUser(id);
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivateBetaUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.reactivateBetaUser(id);
  }

  @Get('users/:id/referrals')
  async getReferrals(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.getReferrals(id);
  }

  // ============ WAITLIST ENDPOINTS ============

  @Post('waitlist/join')
  async joinWaitlist(@Body() dto: JoinWaitlistDto) {
    return this.betaAccessService.joinWaitlist(dto);
  }

  @Get('waitlist')
  async listWaitlist(@Query() query: PaginationQueryDto) {
    return this.betaAccessService.listWaitlist(query);
  }

  @Get('waitlist/stats')
  async getWaitlistStats() {
    return this.betaAccessService.getWaitlistStats();
  }

  @Get('waitlist/:id')
  async getWaitlistEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.getWaitlistEntry(id);
  }

  @Post('waitlist/:id/invite')
  @HttpCode(HttpStatus.OK)
  async inviteFromWaitlist(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.inviteFromWaitlist(id);
  }

  @Post('waitlist/bulk-invite')
  @HttpCode(HttpStatus.OK)
  async bulkInviteFromWaitlist(@Body() dto: BulkInviteFromWaitlistDto) {
    return this.betaAccessService.bulkInviteFromWaitlist(dto.count);
  }

  @Delete('waitlist/:id')
  async removeFromWaitlist(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.removeFromWaitlist(id);
  }

  // ============ FEEDBACK ENDPOINTS ============

  @Post('users/:userId/feedback')
  async createFeedback(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.betaAccessService.createFeedback(userId, dto);
  }

  @Get('feedback')
  async listFeedback(@Query() query: PaginationQueryDto) {
    return this.betaAccessService.listFeedback(query);
  }

  @Get('feedback/:id')
  async getFeedback(@Param('id', ParseUUIDPipe) id: string) {
    return this.betaAccessService.getFeedback(id);
  }

  @Get('users/:userId/feedback')
  async listUserFeedback(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.betaAccessService.listUserFeedback(userId, query);
  }

  @Put('feedback/:id/status')
  async updateFeedbackStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: FeedbackStatus,
  ) {
    return this.betaAccessService.updateFeedbackStatus(id, status);
  }

  // ============ STATS ENDPOINTS ============

  @Get('stats')
  async getBetaStats() {
    return this.betaAccessService.getBetaStats();
  }

  // ============ ADMIN ENDPOINTS ============

  @Post('admin/cleanup-expired-codes')
  @HttpCode(HttpStatus.OK)
  async cleanupExpiredInviteCodes() {
    const count = await this.betaAccessService.cleanupExpiredInviteCodes();
    return { expiredCodesCleanedUp: count };
  }
}
