import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomBytes } from 'crypto';
import { InviteCode, InviteCodeStatus } from './entities/invite-code.entity';
import { BetaUser, BetaUserStatus } from './entities/beta-user.entity';
import { Waitlist, WaitlistStatus } from './entities/waitlist.entity';
import { Feedback, FeedbackStatus } from './entities/feedback.entity';
import {
  CreateInviteCodeDto,
  GenerateBulkInviteCodesDto,
  RegisterBetaUserDto,
  UpdateBetaUserDto,
  JoinWaitlistDto,
  CreateFeedbackDto,
  PaginationQueryDto,
  BetaStatsDto,
  WaitlistStatsDto,
} from './dto';

@Injectable()
export class BetaAccessService {
  constructor(
    @InjectRepository(InviteCode)
    private inviteCodeRepository: Repository<InviteCode>,
    @InjectRepository(BetaUser)
    private betaUserRepository: Repository<BetaUser>,
    @InjectRepository(Waitlist)
    private waitlistRepository: Repository<Waitlist>,
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
  ) {}

  // ============ INVITE CODE METHODS ============

  private generateCode(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }

  async createInviteCode(
    dto: CreateInviteCodeDto,
    createdByUserId?: string,
  ): Promise<InviteCode> {
    const code = this.generateCode();

    const inviteCode = this.inviteCodeRepository.create({
      code,
      maxUses: dto.maxUses ?? 1,
      expiresAt: dto.expiresAt,
      createdByUserId: createdByUserId,
      metadata: dto.metadata,
    });

    return this.inviteCodeRepository.save(inviteCode);
  }

  async generateBulkInviteCodes(
    dto: GenerateBulkInviteCodesDto,
    createdByUserId?: string,
  ): Promise<InviteCode[]> {
    const codes: InviteCode[] = [];

    for (let i = 0; i < dto.count; i++) {
      const inviteCode = this.inviteCodeRepository.create({
        code: this.generateCode(),
        maxUses: dto.maxUsesPerCode ?? 1,
        expiresAt: dto.expiresAt,
        createdByUserId: createdByUserId,
      });
      codes.push(inviteCode);
    }

    return this.inviteCodeRepository.save(codes);
  }

  async validateInviteCode(code: string): Promise<{
    valid: boolean;
    inviteCode?: InviteCode;
    reason?: string;
  }> {
    const inviteCode = await this.inviteCodeRepository.findOne({
      where: { code: code.toUpperCase() },
    });

    if (!inviteCode) {
      return { valid: false, reason: 'Invalid invite code' };
    }

    if (inviteCode.status !== InviteCodeStatus.ACTIVE) {
      return { valid: false, reason: `Invite code is ${inviteCode.status}` };
    }

    if (inviteCode.currentUses >= inviteCode.maxUses) {
      return { valid: false, reason: 'Invite code has reached maximum uses' };
    }

    if (inviteCode.expiresAt && new Date() > inviteCode.expiresAt) {
      await this.inviteCodeRepository.update(inviteCode.id, {
        status: InviteCodeStatus.EXPIRED,
      });
      return { valid: false, reason: 'Invite code has expired' };
    }

    return { valid: true, inviteCode };
  }

  async getInviteCode(id: string): Promise<InviteCode> {
    const inviteCode = await this.inviteCodeRepository.findOne({
      where: { id },
      relations: ['createdByUser'],
    });

    if (!inviteCode) {
      throw new NotFoundException('Invite code not found');
    }

    return inviteCode;
  }

  async listInviteCodes(query: PaginationQueryDto): Promise<{
    data: InviteCode[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await this.inviteCodeRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async revokeInviteCode(id: string): Promise<InviteCode> {
    const inviteCode = await this.getInviteCode(id);

    inviteCode.status = InviteCodeStatus.REVOKED;
    return this.inviteCodeRepository.save(inviteCode);
  }

  // ============ BETA USER METHODS ============

  async registerBetaUser(dto: RegisterBetaUserDto): Promise<BetaUser> {
    const existingUser = await this.betaUserRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered as a beta user');
    }

    const validation = await this.validateInviteCode(dto.inviteCode);
    if (!validation.valid) {
      throw new BadRequestException(validation.reason);
    }

    const inviteCode = validation.inviteCode!;

    const referredByUserId = inviteCode.createdByUserId;

    const betaUser = this.betaUserRepository.create({
      email: dto.email.toLowerCase(),
      stellarAddress: dto.stellarAddress,
      inviteCodeUsed: inviteCode.code,
      referredByUserId,
      metadata: dto.metadata,
      activatedAt: new Date(),
    });

    const savedUser = await this.betaUserRepository.save(betaUser);

    await this.inviteCodeRepository.update(inviteCode.id, {
      currentUses: inviteCode.currentUses + 1,
      status:
        inviteCode.currentUses + 1 >= inviteCode.maxUses
          ? InviteCodeStatus.USED
          : InviteCodeStatus.ACTIVE,
    });

    if (referredByUserId) {
      await this.betaUserRepository.increment(
        { id: referredByUserId },
        'referralCount',
        1,
      );
    }

    const waitlistEntry = await this.waitlistRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (waitlistEntry) {
      await this.waitlistRepository.update(waitlistEntry.id, {
        status: WaitlistStatus.JOINED,
      });
    }

    return savedUser;
  }

  async getBetaUser(id: string): Promise<BetaUser> {
    const user = await this.betaUserRepository.findOne({
      where: { id },
      relations: ['referredByUser', 'referrals'],
    });

    if (!user) {
      throw new NotFoundException('Beta user not found');
    }

    return user;
  }

  async getBetaUserByEmail(email: string): Promise<BetaUser | null> {
    return this.betaUserRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async updateBetaUser(id: string, dto: UpdateBetaUserDto): Promise<BetaUser> {
    const user = await this.getBetaUser(id);

    if (dto.stellarAddress !== undefined) {
      user.stellarAddress = dto.stellarAddress;
    }
    if (dto.metadata !== undefined) {
      user.metadata = { ...user.metadata, ...dto.metadata };
    }

    return this.betaUserRepository.save(user);
  }

  async listBetaUsers(query: PaginationQueryDto): Promise<{
    data: BetaUser[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await this.betaUserRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async suspendBetaUser(id: string): Promise<BetaUser> {
    const user = await this.getBetaUser(id);
    user.status = BetaUserStatus.SUSPENDED;
    return this.betaUserRepository.save(user);
  }

  async revokeBetaUser(id: string): Promise<BetaUser> {
    const user = await this.getBetaUser(id);
    user.status = BetaUserStatus.REVOKED;
    return this.betaUserRepository.save(user);
  }

  async reactivateBetaUser(id: string): Promise<BetaUser> {
    const user = await this.getBetaUser(id);
    user.status = BetaUserStatus.ACTIVE;
    return this.betaUserRepository.save(user);
  }

  async getReferrals(userId: string): Promise<BetaUser[]> {
    return this.betaUserRepository.find({
      where: { referredByUserId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ============ WAITLIST METHODS ============

  private generateReferralCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  async joinWaitlist(dto: JoinWaitlistDto): Promise<Waitlist> {
    const existing = await this.waitlistRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email is already on the waitlist');
    }

    const existingBetaUser = await this.betaUserRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingBetaUser) {
      throw new ConflictException('Email is already registered as a beta user');
    }

    const lastPosition = await this.waitlistRepository
      .createQueryBuilder('waitlist')
      .select('MAX(waitlist.position)', 'maxPosition')
      .getRawOne();

    const position = (lastPosition?.maxPosition ?? 0) + 1;

    let referredByCode: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.waitlistRepository.findOne({
        where: { referralCode: dto.referralCode.toUpperCase() },
      });
      if (referrer) {
        referredByCode = referrer.referralCode;
        await this.waitlistRepository.increment(
          { id: referrer.id },
          'referralCount',
          1,
        );
      }
    }

    const waitlistEntry = this.waitlistRepository.create({
      email: dto.email.toLowerCase(),
      position,
      referralCode: this.generateReferralCode(),
      referredByCode,
      metadata: dto.metadata,
    });

    return this.waitlistRepository.save(waitlistEntry);
  }

  async getWaitlistEntry(id: string): Promise<Waitlist> {
    const entry = await this.waitlistRepository.findOne({ where: { id } });

    if (!entry) {
      throw new NotFoundException('Waitlist entry not found');
    }

    return entry;
  }

  async getWaitlistByEmail(email: string): Promise<Waitlist | null> {
    return this.waitlistRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async listWaitlist(query: PaginationQueryDto): Promise<{
    data: Waitlist[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await this.waitlistRepository.findAndCount({
      where: { status: WaitlistStatus.PENDING },
      order: { position: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async inviteFromWaitlist(waitlistId: string): Promise<{
    waitlist: Waitlist;
    inviteCode: InviteCode;
  }> {
    const entry = await this.getWaitlistEntry(waitlistId);

    if (entry.status !== WaitlistStatus.PENDING) {
      throw new BadRequestException(
        `Waitlist entry is already ${entry.status}`,
      );
    }

    const inviteCode = await this.createInviteCode({ maxUses: 1 });

    entry.status = WaitlistStatus.INVITED;
    entry.inviteCodeSent = inviteCode.code;
    entry.invitedAt = new Date();

    const waitlist = await this.waitlistRepository.save(entry);

    return { waitlist, inviteCode };
  }

  async bulkInviteFromWaitlist(count: number): Promise<
    Array<{
      waitlist: Waitlist;
      inviteCode: InviteCode;
    }>
  > {
    const entries = await this.waitlistRepository.find({
      where: { status: WaitlistStatus.PENDING },
      order: { position: 'ASC' },
      take: count,
    });

    const results: Array<{ waitlist: Waitlist; inviteCode: InviteCode }> = [];

    for (const entry of entries) {
      const result = await this.inviteFromWaitlist(entry.id);
      results.push(result);
    }

    return results;
  }

  async getWaitlistStats(): Promise<WaitlistStatsDto> {
    const [totalWaiting, totalInvited, totalJoined] = await Promise.all([
      this.waitlistRepository.count({
        where: { status: WaitlistStatus.PENDING },
      }),
      this.waitlistRepository.count({
        where: { status: WaitlistStatus.INVITED },
      }),
      this.waitlistRepository.count({
        where: { status: WaitlistStatus.JOINED },
      }),
    ]);

    return { totalWaiting, totalInvited, totalJoined };
  }

  async removeFromWaitlist(id: string): Promise<Waitlist> {
    const entry = await this.getWaitlistEntry(id);
    entry.status = WaitlistStatus.REMOVED;
    return this.waitlistRepository.save(entry);
  }

  // ============ FEEDBACK METHODS ============

  async createFeedback(
    betaUserId: string,
    dto: CreateFeedbackDto,
  ): Promise<Feedback> {
    await this.getBetaUser(betaUserId);

    const feedback = this.feedbackRepository.create({
      betaUserId,
      type: dto.type,
      title: dto.title,
      description: dto.description,
      rating: dto.rating,
      metadata: dto.metadata,
    });

    return this.feedbackRepository.save(feedback);
  }

  async getFeedback(id: string): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({
      where: { id },
      relations: ['betaUser'],
    });

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    return feedback;
  }

  async listFeedback(query: PaginationQueryDto): Promise<{
    data: Feedback[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await this.feedbackRepository.findAndCount({
      relations: ['betaUser'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async listUserFeedback(
    betaUserId: string,
    query: PaginationQueryDto,
  ): Promise<{
    data: Feedback[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await this.feedbackRepository.findAndCount({
      where: { betaUserId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async updateFeedbackStatus(
    id: string,
    status: FeedbackStatus,
  ): Promise<Feedback> {
    const feedback = await this.getFeedback(id);
    feedback.status = status;
    return this.feedbackRepository.save(feedback);
  }

  // ============ STATS & ADMIN ============

  async getBetaStats(): Promise<BetaStatsDto> {
    const [
      totalBetaUsers,
      activeBetaUsers,
      totalInviteCodes,
      activeInviteCodes,
      totalWaitlist,
      totalFeedback,
    ] = await Promise.all([
      this.betaUserRepository.count(),
      this.betaUserRepository.count({
        where: { status: BetaUserStatus.ACTIVE },
      }),
      this.inviteCodeRepository.count(),
      this.inviteCodeRepository.count({
        where: { status: InviteCodeStatus.ACTIVE },
      }),
      this.waitlistRepository.count({
        where: { status: WaitlistStatus.PENDING },
      }),
      this.feedbackRepository.count(),
    ]);

    return {
      totalBetaUsers,
      activeBetaUsers,
      totalInviteCodes,
      activeInviteCodes,
      totalWaitlist,
      totalFeedback,
    };
  }

  async cleanupExpiredInviteCodes(): Promise<number> {
    const result = await this.inviteCodeRepository.update(
      {
        status: InviteCodeStatus.ACTIVE,
        expiresAt: LessThan(new Date()),
      },
      { status: InviteCodeStatus.EXPIRED },
    );

    return result.affected ?? 0;
  }
}
