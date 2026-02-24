import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContestsService } from './contests.service';
import { Contest, ContestMetric, ContestStatus } from './entities/contest.entity';
import { Signal, SignalStatus } from '../signals/entities/signal.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ContestsService', () => {
  let service: ContestsService;
  let contestRepository: Repository<Contest>;
  let signalRepository: Repository<Signal>;

  const mockContestRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockSignalRepository = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContestsService,
        {
          provide: getRepositoryToken(Contest),
          useValue: mockContestRepository,
        },
        {
          provide: getRepositoryToken(Signal),
          useValue: mockSignalRepository,
        },
      ],
    }).compile();

    service = module.get<ContestsService>(ContestsService);
    contestRepository = module.get<Repository<Contest>>(getRepositoryToken(Contest));
    signalRepository = module.get<Repository<Signal>>(getRepositoryToken(Signal));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createContest', () => {
    it('should create a contest successfully', async () => {
      const dto = {
        name: 'Weekly ROI Contest',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-08T00:00:00Z',
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 3,
        prizePool: '1000',
      };

      const expectedContest = {
        id: '1',
        ...dto,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        status: ContestStatus.ACTIVE,
        winners: null,
      };

      mockContestRepository.create.mockReturnValue(expectedContest);
      mockContestRepository.save.mockResolvedValue(expectedContest);

      const result = await service.createContest(dto);

      expect(result).toEqual(expectedContest);
      expect(mockContestRepository.create).toHaveBeenCalled();
      expect(mockContestRepository.save).toHaveBeenCalled();
    });

    it('should throw error if end time is before start time', async () => {
      const dto = {
        name: 'Invalid Contest',
        startTime: '2024-01-08T00:00:00Z',
        endTime: '2024-01-01T00:00:00Z',
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 3,
        prizePool: '1000',
      };

      await expect(service.createContest(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getContest', () => {
    it('should return a contest by id', async () => {
      const contest = {
        id: '1',
        name: 'Test Contest',
        status: ContestStatus.ACTIVE,
      };

      mockContestRepository.findOne.mockResolvedValue(contest);

      const result = await service.getContest('1');

      expect(result).toEqual(contest);
      expect(mockContestRepository.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw NotFoundException if contest not found', async () => {
      mockContestRepository.findOne.mockResolvedValue(null);

      await expect(service.getContest('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('finalizeContest', () => {
    it('should finalize contest and select winners', async () => {
      const contest = {
        id: '1',
        name: 'Test Contest',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-01-08'),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 2,
        prizePool: '1000',
        status: ContestStatus.ACTIVE,
        winners: null,
      };

      const signals = [
        {
          id: 's1',
          providerId: 'p1',
          entryPrice: '100',
          closePrice: '150',
          totalCopiedVolume: '1000',
          totalProfitLoss: '50',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 's2',
          providerId: 'p1',
          entryPrice: '200',
          closePrice: '250',
          totalCopiedVolume: '2000',
          totalProfitLoss: '50',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-03'),
        },
        {
          id: 's3',
          providerId: 'p2',
          entryPrice: '100',
          closePrice: '120',
          totalCopiedVolume: '500',
          totalProfitLoss: '20',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-04'),
        },
        {
          id: 's4',
          providerId: 'p2',
          entryPrice: '150',
          closePrice: '160',
          totalCopiedVolume: '600',
          totalProfitLoss: '10',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-05'),
        },
      ];

      mockContestRepository.findOne.mockResolvedValue(contest);
      mockSignalRepository.find.mockResolvedValue(signals);
      mockContestRepository.save.mockResolvedValue({
        ...contest,
        status: ContestStatus.FINALIZED,
        winners: ['p1', 'p2'],
      });

      const result = await service.finalizeContest('1');

      expect(result.winners).toHaveLength(2);
      expect(result.winners[0]).toBe('p1');
      expect(result.prizes['p1']).toBe('500.00000000');
      expect(result.prizes['p2']).toBe('300.00000000');
      expect(mockContestRepository.save).toHaveBeenCalled();
    });

    it('should throw error if contest not ended', async () => {
      const contest = {
        id: '1',
        endTime: new Date(Date.now() + 86400000),
        status: ContestStatus.ACTIVE,
      };

      mockContestRepository.findOne.mockResolvedValue(contest);

      await expect(service.finalizeContest('1')).rejects.toThrow(BadRequestException);
    });

    it('should throw error if already finalized', async () => {
      const contest = {
        id: '1',
        endTime: new Date('2024-01-01'),
        status: ContestStatus.FINALIZED,
      };

      mockContestRepository.findOne.mockResolvedValue(contest);

      await expect(service.finalizeContest('1')).rejects.toThrow(BadRequestException);
    });

    it('should handle no qualified entries', async () => {
      const contest = {
        id: '1',
        name: 'Test Contest',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-01-08'),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 5,
        prizePool: '1000',
        status: ContestStatus.ACTIVE,
        winners: null,
      };

      const signals = [
        {
          id: 's1',
          providerId: 'p1',
          entryPrice: '100',
          closePrice: '150',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-02'),
        },
      ];

      mockContestRepository.findOne.mockResolvedValue(contest);
      mockSignalRepository.find.mockResolvedValue(signals);
      mockContestRepository.save.mockResolvedValue({
        ...contest,
        status: ContestStatus.FINALIZED,
        winners: [],
      });

      const result = await service.finalizeContest('1');

      expect(result.winners).toHaveLength(0);
      expect(result.prizes).toEqual({});
    });
  });

  describe('getContestLeaderboard', () => {
    it('should return leaderboard with sorted entries', async () => {
      const contest = {
        id: '1',
        name: 'Test Contest',
        startTime: new Date('2024-01-01'),
        endTime: new Date('2024-01-08'),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 1,
        prizePool: '1000',
        status: ContestStatus.ACTIVE,
        winners: null,
      };

      const signals = [
        {
          id: 's1',
          providerId: 'p1',
          entryPrice: '100',
          closePrice: '200',
          totalCopiedVolume: '1000',
          totalProfitLoss: '100',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 's2',
          providerId: 'p2',
          entryPrice: '100',
          closePrice: '150',
          totalCopiedVolume: '500',
          totalProfitLoss: '50',
          status: SignalStatus.CLOSED,
          createdAt: new Date('2024-01-03'),
        },
      ];

      mockContestRepository.findOne.mockResolvedValue(contest);
      mockSignalRepository.find.mockResolvedValue(signals);

      const result = await service.getContestLeaderboard('1');

      expect(result.contestId).toBe('1');
      expect(result.entries).toHaveLength(2);
      expect(parseFloat(result.entries[0].score)).toBeGreaterThan(parseFloat(result.entries[1].score));
    });
  });

  describe('getActiveContests', () => {
    it('should return active contests', async () => {
      const contests = [
        {
          id: '1',
          name: 'Contest 1',
          status: ContestStatus.ACTIVE,
          startTime: new Date('2024-01-01'),
        },
      ];

      mockContestRepository.find.mockResolvedValue(contests);

      const result = await service.getActiveContests();

      expect(result).toEqual(contests);
      expect(mockContestRepository.find).toHaveBeenCalled();
    });
  });

  describe('getAllContests', () => {
    it('should return all contests with optional status filter', async () => {
      const contests = [
        { id: '1', status: ContestStatus.ACTIVE },
        { id: '2', status: ContestStatus.FINALIZED },
      ];

      mockContestRepository.find.mockResolvedValue(contests);

      const result = await service.getAllContests();

      expect(result).toEqual(contests);
    });

    it('should filter by status', async () => {
      const contests = [{ id: '1', status: ContestStatus.ACTIVE }];

      mockContestRepository.find.mockResolvedValue(contests);

      const result = await service.getAllContests(ContestStatus.ACTIVE);

      expect(result).toEqual(contests);
    });
  });
});
