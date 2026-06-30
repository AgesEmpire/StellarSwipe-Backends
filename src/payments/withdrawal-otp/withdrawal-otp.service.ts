import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { WithdrawalOtp } from './entities/withdrawal-otp.entity';
import { EmailService } from '../../email/email.service';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const BCRYPT_ROUNDS = 10;

@Injectable()
export class WithdrawalOtpService {
  private readonly logger = new Logger(WithdrawalOtpService.name);
  private readonly maxAttempts: number;
  private readonly lockoutDurationMs: number;

  constructor(
    @InjectRepository(WithdrawalOtp)
    private readonly otpRepository: Repository<WithdrawalOtp>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    this.maxAttempts = this.configService.get<number>('WITHDRAWAL_OTP_MAX_ATTEMPTS', 5);
    this.lockoutDurationMs = this.configService.get<number>('WITHDRAWAL_OTP_LOCKOUT_MS', 15 * 60 * 1000);
  }

  async requestOtp(
    userId: string,
    withdrawalRequestId: string,
    userEmail: string,
  ): Promise<void> {
    // Invalidate any existing unused OTP for this withdrawal
    await this.otpRepository
      .createQueryBuilder()
      .update(WithdrawalOtp)
      .set({ usedAt: new Date() })
      .where('userId = :userId AND withdrawalRequestId = :withdrawalRequestId AND usedAt IS NULL', {
        userId,
        withdrawalRequestId,
      })
      .execute();

    const plainOtp = this.generateOtp();
    const otpHash = await bcrypt.hash(plainOtp, BCRYPT_ROUNDS);

    const record = this.otpRepository.create({
      userId,
      withdrawalRequestId,
      otpHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      usedAt: null,
      attemptCount: 0,
      lockedUntil: null,
    });

    await this.otpRepository.save(record);

    await this.emailService.sendEmail({
      to: userEmail,
      subject: 'Withdrawal Confirmation OTP',
      template: 'security-alert',
      variables: {
        name: 'User',
        message: `Your withdrawal confirmation code is: ${plainOtp}. It expires in 10 minutes. Do not share this code.`,
      },
    });

    this.logger.log(`Withdrawal OTP issued for user ${userId}, request ${withdrawalRequestId}`);
  }

  async verifyOtp(
    userId: string,
    withdrawalRequestId: string,
    plainOtp: string,
  ): Promise<void> {
    const record = await this.otpRepository.findOne({
      where: { userId, withdrawalRequestId, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (!record || record.isUsed()) {
      throw new NotFoundException('No active OTP found for this withdrawal request.');
    }

    if (record.isExpired()) {
      throw new ForbiddenException('OTP has expired. Please request a new one.');
    }

    if (record.isLocked()) {
      throw new ForbiddenException(
        'Too many invalid OTP attempts. Please wait before retrying.',
      );
    }

    const isMatch = await bcrypt.compare(plainOtp, record.otpHash);

    if (!isMatch) {
      record.attemptCount += 1;
      if (record.attemptCount >= this.maxAttempts) {
        record.lockedUntil = new Date(Date.now() + this.lockoutDurationMs);
        this.logger.warn(
          `Withdrawal OTP locked for user ${userId}, request ${withdrawalRequestId} after ${record.attemptCount} failed attempts`,
        );
      }
      await this.otpRepository.save(record);
      const remaining = this.maxAttempts - record.attemptCount;
      throw new ForbiddenException(
        remaining > 0
          ? `Invalid OTP. ${remaining} attempt(s) remaining.`
          : 'OTP locked due to too many failed attempts.',
      );
    }

    record.usedAt = new Date();
    await this.otpRepository.save(record);

    this.logger.log(`Withdrawal OTP verified for user ${userId}, request ${withdrawalRequestId}`);
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.otpRepository.delete({
      expiresAt: LessThan(new Date()),
    });
    return result.affected ?? 0;
  }

  private generateOtp(): string {
    const bytes = crypto.randomBytes(4);
    const num = bytes.readUInt32BE(0) % Math.pow(10, OTP_LENGTH);
    return num.toString().padStart(OTP_LENGTH, '0');
  }
}
