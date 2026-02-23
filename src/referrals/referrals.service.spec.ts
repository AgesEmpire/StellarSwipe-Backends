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
  let referralRepository: Repository<Referral>;
  let userRepository: Repository<User>;
  let tradeRepository: Repository<Trade>;
  let eventEmitter: EventEmitter2;

  const mockUser = {
    id: 'user-1',
    username: 'testuser',
    walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH',
  };

  const mockReferrer = {
    id: 'user-2',
    username: 'referrer',
    walletAddress: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
  };

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
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReferralsService>(ReferralsService);
    referralRepository = module.get<Repository<Referral>>(
      getRepositoryToken(Referral),
    );
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    tradeRepository = module.get<Repository<Trade>>(getRepositoryToken(Trade));
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  describe('getUserReferralCode', () => {
    it('should generate referral code from wallet address', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser as User);

      const code = await service.getUserReferralCode(mockUser.id);

      expect(code).toBeDefined();
      expect(code.length).toBe(8);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        select: ['id', 'username', 'walletAddress'],
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getUserReferralCode('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('claimReferral', () => {
    it('should successfully claim a referral', async () => {
      const referralCode = 'STELLAR1';
      const mockReferral = {
        id: 'ref-1',
        referrerId: mockReferrer.id,
        referredId: mockUser.id,
        referralCode,
        status: ReferralStatus.PENDING,
      };

      jest.spyOn(referralRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(userRepository, 'find').mockResolvedValue([mockReferrer as User]);
      jest.spyOn(referralRepository, 'create').mockReturnValue(mockReferral as Referral);
      jest.spyOn(referralRepository, 'save').mockResolvedValue(mockReferral as Referral);

      const result = await service.claimReferral(mockUser.id, referralCode);

      expect(result).toEqual(mockReferral);
      expect(referralRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if user already claimed', async () => {
      const existingReferral = { id: 'ref-1', referredId: mockUser.id };
      jest.spyOn(referralRepository, 'findOne').mockResolvedValue(existingReferral as Referral);

      await expect(
        service.claimReferral(mockUser.id, 'STELLAR1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for self-referral', async () => {
      jest.spyOn(referralRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(userRepository, 'find').mockResolvedValue([mockUser as User]);

      await expect(
        service.claimReferral(mockUser.id, 'TESTCODE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid code', async () => {
      jest.spyOn(referralRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(userRepository, 'find').mockResolvedValue([]);

      await expect(
        service.claimReferral(mockUser.id, 'INVALID1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkAndRewardReferral', () => {
    it('should reward referral on first trade completion', async () => {
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

      jest.spyOn(tradeRepository, 'findOne').mockResolvedValue(mockTrade as Trade);
      jest.spyOn(tradeRepository, 'count').mockResolvedValue(1);
      jest.spyOn(referralRepository, 'findOne').mockResolvedValue(mockReferral as Referral);
      jest.spyOn(referralRepository, 'save').mockResolvedValue({
        ...mockReferral,
        status: ReferralStatus.REWARDED,
      } as Referral);
      jest.spyOn(eventEmitter, 'emit');

      await service.checkAndRewardReferral(tradeId);

      expect(referralRepository.save).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'referral.rewarded',
        expect.objectContaining({
          referrerId: mockReferrer.id,
          referredId: mockUser.id,
          amount: 5,
        }),
      );
    });

    it('should not reward if trade value below minimum', async () => {
      const mockTrade = {
        id: 'trade-1',
        userId: mockUser.id,
        status: TradeStatus.SETTLED,
        totalValue: '5.00',
        user: mockUser,
      };

      jest.spyOn(tradeRepository, 'findOne').mockResolvedValue(mockTrade as Trade);
      jest.spyOn(tradeRepository, 'count').mockResolvedValue(1);
      jest.spyOn(referralRepository, 'save');

      await service.checkAndRewardReferral('trade-1');

      expect(referralRepository.save).not.toHaveBeenCalled();
    });

    it('should not reward if not first trade', async () => {
      const mockTrade = {
        id: 'trade-1',
        userId: mockUser.id,
        status: TradeStatus.SETTLED,
        totalValue: '15.00',
        user: mockUser,
      };

      jest.spyOn(tradeRepository, 'findOne').mockResolvedValue(mockTrade as Trade);
      jest.spyOn(tradeRepository, 'count').mockResolvedValue(2);
      jest.spyOn(referralRepository, 'save');

      await service.checkAndRewardReferral('trade-1');

      expect(referralRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getReferralStats', () => {
    it('should return referral statistics', async () => {
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

      jest.spyOn(userRepository, 'findOne').mockResolvedValue(mockUser as User);
      jest.spyOn(referralRepository, 'find').mockResolvedValue(mockReferrals as Referral[]);

      const stats = await service.getReferralStats(mockUser.id);

      expect(stats.totalInvites).toBe(2);
      expect(stats.successfulConversions).toBe(1);
      expect(stats.pendingReferrals).toBe(1);
      expect(stats.totalEarnings).toBe('5.0000000');
      expect(stats.referrals).toHaveLength(2);
    });
  });
});
