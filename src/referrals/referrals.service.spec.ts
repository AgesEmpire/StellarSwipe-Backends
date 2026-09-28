import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { Referral, ReferralStatus } from './entities/referral.entity';
import { User } from '../users/entities/user.entity';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';

describe('ReferralsService', () => {
  let service: ReferralsService;
  let referralRepository: jest.Mocked<Repository<Referral>>;
  let userRepository: jest.Mocked<Repository<User>>;
  let tradeRepository: jest.Mocked<Repository<Trade>>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockUser = {
    id: 'user-1',
    username: 'testuser',
    referralCode: undefined,
  } as unknown as User;

  const mockReferrer = {
    id: 'user-2',
    username: 'referrer',
    referralCode: 'STELLAR1',
  } as unknown as User;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralsService,
        {
          provide: getRepositoryToken(Referral),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: {
            findOne: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
    referralRepository = module.get(getRepositoryToken(Referral));
    userRepository = module.get(getRepositoryToken(User));
    tradeRepository = module.get(getRepositoryToken(Trade));
    eventEmitter = module.get(EventEmitter2);
  });

  describe('generateReferralCode', () => {
    it('generates an 8-character alphanumeric code', () => {
      const code = service.generateReferralCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[A-Z2-9]+$/);
    });

    it('generates unique codes across multiple calls', () => {
      const codes = new Set(Array.from({ length: 100 }, () => service.generateReferralCode()));
      expect(codes.size).toBeGreaterThan(90);
    });
  });

  describe('getUserReferralCode', () => {
    it('returns existing stored code without generating a new one', async () => {
      userRepository.findOne.mockResolvedValue({ ...mockReferrer } as User);

      const code = await service.getUserReferralCode(mockReferrer.id);

      expect(code).toBe('STELLAR1');
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('generates and persists a new code when user has none', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({ id: 'user-1', referralCode: undefined } as User)
        .mockResolvedValueOnce(null);
      userRepository.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      const code = await service.getUserReferralCode('user-1');

      expect(code).toHaveLength(8);
      expect(userRepository.update).toHaveBeenCalledWith('user-1', { referralCode: code });
    });

    it('throws NotFoundException if user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserReferralCode('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('claimReferral', () => {
    it('successfully claims a referral', async () => {
      const mockReferral = {
        id: 'ref-1',
        referrerId: mockReferrer.id,
        referredId: mockUser.id,
        referralCode: 'STELLAR1',
        status: ReferralStatus.PENDING,
      };

      referralRepository.findOne.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue({ id: mockReferrer.id } as User);
      referralRepository.create.mockReturnValue(mockReferral as Referral);
      referralRepository.save.mockResolvedValue(mockReferral as Referral);

      const result = await service.claimReferral(mockUser.id, 'STELLAR1');

      expect(result).toEqual(mockReferral);
      expect(referralRepository.save).toHaveBeenCalled();
    });

    it('throws BadRequestException if user already claimed', async () => {
      referralRepository.findOne.mockResolvedValue({ id: 'ref-1' } as Referral);

      await expect(service.claimReferral(mockUser.id, 'STELLAR1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for self-referral', async () => {
      referralRepository.findOne.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue({ id: mockUser.id } as User);

      await expect(service.claimReferral(mockUser.id, 'ANYCODE1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid (unknown) referral code', async () => {
      referralRepository.findOne.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.claimReferral(mockUser.id, 'INVALID1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkAndRewardReferral', () => {
    it('rewards referral on first settled trade above minimum value', async () => {
      const tradeId = 'trade-1';
      const mockTrade = {
        id: tradeId,
        userId: mockUser.id,
        status: TradeStatus.SETTLED,
        totalValue: '15.00',
        user: mockUser,
      };

      const mockReferral = {
        id: 'ref-1',
        referrerId: mockReferrer.id,
        referredId: mockUser.id,
        status: ReferralStatus.PENDING,
        rewardAmount: '5.0000000',
        referrer: mockReferrer,
      };

      tradeRepository.findOne.mockResolvedValue(mockTrade as Trade);
      tradeRepository.count.mockResolvedValue(1);
      referralRepository.findOne.mockResolvedValue(mockReferral as Referral);
      referralRepository.save.mockResolvedValue({ ...mockReferral, status: ReferralStatus.REWARDED } as Referral);
      eventEmitter.emit.mockReturnValue(true);

      await service.checkAndRewardReferral(tradeId);

      expect(referralRepository.save).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith('referral.rewarded', expect.objectContaining({
        referrerId: mockReferrer.id,
        referredId: mockUser.id,
        amount: 5,
      }));
    });

    it('does not reward if trade value is below minimum', async () => {
      const mockTrade = { id: 'trade-1', userId: mockUser.id, status: TradeStatus.SETTLED, totalValue: '5.00', user: mockUser };
      tradeRepository.findOne.mockResolvedValue(mockTrade as Trade);
      tradeRepository.count.mockResolvedValue(1);

      await service.checkAndRewardReferral('trade-1');

      expect(referralRepository.save).not.toHaveBeenCalled();
    });

    it('does not reward if it is not the user\'s first settled trade', async () => {
      const mockTrade = { id: 'trade-1', userId: mockUser.id, status: TradeStatus.SETTLED, totalValue: '15.00', user: mockUser };
      tradeRepository.findOne.mockResolvedValue(mockTrade as Trade);
      tradeRepository.count.mockResolvedValue(2);

      await service.checkAndRewardReferral('trade-1');

      expect(referralRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getReferralStats', () => {
    it('returns referral statistics with referred user list', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({ id: mockUser.id, referralCode: 'TESTCODE' } as unknown as User)
        .mockResolvedValueOnce(null);

      const mockReferrals = [
        {
          id: 'ref-1',
          referrerId: mockUser.id,
          status: ReferralStatus.REWARDED,
          rewardAmount: '5.0000000',
          createdAt: new Date(),
          rewardedAt: new Date(),
          referred: { username: 'user1' },
        },
        {
          id: 'ref-2',
          referrerId: mockUser.id,
          status: ReferralStatus.PENDING,
          rewardAmount: '5.0000000',
          createdAt: new Date(),
          referred: { username: 'user2' },
        },
      ];

      referralRepository.find.mockResolvedValue(mockReferrals as Referral[]);

      const stats = await service.getReferralStats(mockUser.id);

      expect(stats.referralCode).toBe('TESTCODE');
      expect(stats.totalInvites).toBe(2);
      expect(stats.successfulConversions).toBe(1);
      expect(stats.pendingReferrals).toBe(1);
      expect(stats.totalEarnings).toBe('5.0000000');
      expect(stats.referrals).toHaveLength(2);
    });
  });
});
