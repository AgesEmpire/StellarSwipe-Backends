import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WithdrawalOtpService } from './withdrawal-otp.service';
import { WithdrawalOtp } from './entities/withdrawal-otp.entity';
import { EmailService } from '../../email/email.service';
import * as bcrypt from 'bcrypt';

const USER_ID = 'user-uuid-1';
const WITHDRAWAL_ID = 'withdrawal-uuid-1';
const PLAIN_OTP = '123456';

function makeOtpRecord(overrides: Partial<WithdrawalOtp> = {}): WithdrawalOtp {
  const record = new WithdrawalOtp();
  record.id = 'otp-uuid-1';
  record.userId = USER_ID;
  record.withdrawalRequestId = WITHDRAWAL_ID;
  record.otpHash = 'hash';
  record.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  record.usedAt = null;
  record.attemptCount = 0;
  record.lockedUntil = null;
  record.createdAt = new Date();
  return Object.assign(record, overrides);
}

describe('WithdrawalOtpService', () => {
  let service: WithdrawalOtpService;
  let otpRepo: jest.Mocked<Repository<WithdrawalOtp>>;
  let emailService: jest.Mocked<EmailService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalOtpService,
        {
          provide: getRepositoryToken(WithdrawalOtp),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              update: jest.fn().mockReturnThis(),
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue({ affected: 0 }),
            }),
          },
        },
        {
          provide: EmailService,
          useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: any) => {
              if (key === 'WITHDRAWAL_OTP_MAX_ATTEMPTS') return 5;
              if (key === 'WITHDRAWAL_OTP_LOCKOUT_MS') return 15 * 60 * 1000;
              return defaultVal;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(WithdrawalOtpService);
    otpRepo = module.get(getRepositoryToken(WithdrawalOtp));
    emailService = module.get(EmailService);
  });

  describe('requestOtp', () => {
    it('sends an OTP email and persists the hashed OTP', async () => {
      otpRepo.create.mockReturnValue(makeOtpRecord());
      otpRepo.save.mockResolvedValue(makeOtpRecord());

      await service.requestOtp(USER_ID, WITHDRAWAL_ID, 'user@example.com');

      expect(otpRepo.save).toHaveBeenCalledTimes(1);
      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com' }),
      );
    });
  });

  describe('verifyOtp', () => {
    it('marks the OTP as used on successful verification', async () => {
      const record = makeOtpRecord({ otpHash: await bcrypt.hash(PLAIN_OTP, 10) });
      record.isUsed = () => false;
      record.isExpired = () => false;
      record.isLocked = () => false;
      otpRepo.findOne.mockResolvedValue(record);
      otpRepo.save.mockResolvedValue({ ...record, usedAt: new Date() });

      await expect(service.verifyOtp(USER_ID, WITHDRAWAL_ID, PLAIN_OTP)).resolves.toBeUndefined();
      expect(otpRepo.save).toHaveBeenCalledWith(expect.objectContaining({ usedAt: expect.any(Date) }));
    });

    it('throws NotFoundException when no active OTP exists', async () => {
      otpRepo.findOne.mockResolvedValue(null);
      await expect(service.verifyOtp(USER_ID, WITHDRAWAL_ID, PLAIN_OTP)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when OTP is expired', async () => {
      const record = makeOtpRecord({ expiresAt: new Date(Date.now() - 1000) });
      record.isUsed = () => false;
      record.isExpired = () => true;
      record.isLocked = () => false;
      otpRepo.findOne.mockResolvedValue(record);
      await expect(service.verifyOtp(USER_ID, WITHDRAWAL_ID, PLAIN_OTP)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException and locks after exceeding max attempts', async () => {
      const record = makeOtpRecord({
        otpHash: await bcrypt.hash('999999', 10),
        attemptCount: 4,
      });
      record.isUsed = () => false;
      record.isExpired = () => false;
      record.isLocked = () => false;
      otpRepo.findOne.mockResolvedValue(record);
      otpRepo.save.mockResolvedValue({ ...record, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) });

      await expect(service.verifyOtp(USER_ID, WITHDRAWAL_ID, PLAIN_OTP)).rejects.toThrow(ForbiddenException);
      expect(otpRepo.save).toHaveBeenCalledWith(expect.objectContaining({ lockedUntil: expect.any(Date) }));
    });

    it('throws ForbiddenException when OTP is locked', async () => {
      const record = makeOtpRecord({ lockedUntil: new Date(Date.now() + 60_000) });
      record.isUsed = () => false;
      record.isExpired = () => false;
      record.isLocked = () => true;
      otpRepo.findOne.mockResolvedValue(record);
      await expect(service.verifyOtp(USER_ID, WITHDRAWAL_ID, PLAIN_OTP)).rejects.toThrow(ForbiddenException);
    });
  });
});
