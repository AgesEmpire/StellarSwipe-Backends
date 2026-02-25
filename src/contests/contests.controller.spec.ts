import { Test, TestingModule } from '@nestjs/testing';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
import { ContestMetric, ContestStatus } from './entities/contest.entity';

describe('ContestsController', () => {
  let controller: ContestsController;
  let service: ContestsService;

  const mockContestsService = {
    createContest: jest.fn(),
    getAllContests: jest.fn(),
    getActiveContests: jest.fn(),
    getContest: jest.fn(),
    getContestLeaderboard: jest.fn(),
    finalizeContest: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContestsController],
      providers: [
        {
          provide: ContestsService,
          useValue: mockContestsService,
        },
      ],
    }).compile();

    controller = module.get<ContestsController>(ContestsController);
    service = module.get<ContestsService>(ContestsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createContest', () => {
    it('should create a contest', async () => {
      const dto = {
        name: 'Weekly Contest',
        startTime: '2024-01-01T00:00:00Z',
        endTime: '2024-01-08T00:00:00Z',
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 3,
        prizePool: '1000',
      };

      const expectedResult = { id: '1', ...dto };
      mockContestsService.createContest.mockResolvedValue(expectedResult);

      const result = await controller.createContest(dto);

      expect(result).toEqual(expectedResult);
      expect(service.createContest).toHaveBeenCalledWith(dto);
    });
  });

  describe('getContests', () => {
    it('should return all contests', async () => {
      const contests = [{ id: '1', name: 'Contest 1' }];
      mockContestsService.getAllContests.mockResolvedValue(contests);

      const result = await controller.getContests({});

      expect(result).toEqual(contests);
      expect(service.getAllContests).toHaveBeenCalledWith(undefined, 50);
    });

    it('should filter by status', async () => {
      const contests = [{ id: '1', status: ContestStatus.ACTIVE }];
      mockContestsService.getAllContests.mockResolvedValue(contests);

      const result = await controller.getContests({ status: 'ACTIVE' });

      expect(result).toEqual(contests);
      expect(service.getAllContests).toHaveBeenCalledWith(ContestStatus.ACTIVE, 50);
    });
  });

  describe('getActiveContests', () => {
    it('should return active contests', async () => {
      const contests = [{ id: '1', status: ContestStatus.ACTIVE }];
      mockContestsService.getActiveContests.mockResolvedValue(contests);

      const result = await controller.getActiveContests();

      expect(result).toEqual(contests);
      expect(service.getActiveContests).toHaveBeenCalled();
    });
  });

  describe('getContest', () => {
    it('should return a contest by id', async () => {
      const contest = { id: '1', name: 'Test Contest' };
      mockContestsService.getContest.mockResolvedValue(contest);

      const result = await controller.getContest('1');

      expect(result).toEqual(contest);
      expect(service.getContest).toHaveBeenCalledWith('1');
    });
  });

  describe('getLeaderboard', () => {
    it('should return contest leaderboard', async () => {
      const leaderboard = {
        contestId: '1',
        contestName: 'Test Contest',
        entries: [],
      };
      mockContestsService.getContestLeaderboard.mockResolvedValue(leaderboard);

      const result = await controller.getLeaderboard('1');

      expect(result).toEqual(leaderboard);
      expect(service.getContestLeaderboard).toHaveBeenCalledWith('1');
    });
  });

  describe('finalizeContest', () => {
    it('should finalize a contest', async () => {
      const finalizeResult = {
        winners: ['p1', 'p2'],
        prizes: { p1: '500', p2: '300' },
      };
      mockContestsService.finalizeContest.mockResolvedValue(finalizeResult);

      const result = await controller.finalizeContest('1');

      expect(result).toEqual(finalizeResult);
      expect(service.finalizeContest).toHaveBeenCalledWith('1');
    });
  });
});
