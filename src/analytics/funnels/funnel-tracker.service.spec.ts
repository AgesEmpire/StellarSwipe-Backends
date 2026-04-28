import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FunnelTrackerService } from './funnel-tracker.service';
import { Funnel } from './entities/funnel.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { UserFunnelProgress } from './entities/user-funnel-progress.entity';

const mockFunnel = {
  id: 'funnel-1',
  name: 'signup-funnel',
  isActive: true,
  steps: [
    { id: 's1', key: 'signup', name: 'Signup', stepOrder: 0 },
    { id: 's2', key: 'wallet_connect', name: 'Wallet Connect', stepOrder: 1 },
    { id: 's3', key: 'first_signal_view', name: 'First Signal View', stepOrder: 2 },
    { id: 's4', key: 'first_trade', name: 'First Trade', stepOrder: 3 },
  ],
};

describe('FunnelTrackerService', () => {
  let service: FunnelTrackerService;

  const mockFunnelRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    count: jest.fn(),
  };
  const mockStepRepo = { create: jest.fn(), save: jest.fn() };
  const mockProgressRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunnelTrackerService,
        { provide: getRepositoryToken(Funnel), useValue: mockFunnelRepo },
        { provide: getRepositoryToken(FunnelStep), useValue: mockStepRepo },
        { provide: getRepositoryToken(UserFunnelProgress), useValue: mockProgressRepo },
      ],
    }).compile();

    service = module.get<FunnelTrackerService>(FunnelTrackerService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordStep', () => {
    it('creates new progress when user has no existing progress', async () => {
      mockFunnelRepo.findOne.mockResolvedValue(mockFunnel);
      mockProgressRepo.findOne.mockResolvedValue(null);
      mockProgressRepo.create.mockReturnValue({ userId: 'u1', completedSteps: ['signup'] });
      mockProgressRepo.save.mockResolvedValue({});

      await service.recordStep('u1', 'signup-funnel', 'signup');

      expect(mockProgressRepo.create).toHaveBeenCalled();
      expect(mockProgressRepo.save).toHaveBeenCalled();
    });

    it('updates existing progress and marks completed when all steps done', async () => {
      const progress = {
        userId: 'u1',
        currentStep: 2,
        completedSteps: ['signup', 'wallet_connect', 'first_signal_view'],
        lastActivityAt: new Date(),
        completedAt: undefined,
      };
      mockFunnelRepo.findOne.mockResolvedValue(mockFunnel);
      mockProgressRepo.findOne.mockResolvedValue(progress);
      mockProgressRepo.save.mockResolvedValue({});

      await service.recordStep('u1', 'signup-funnel', 'first_trade');

      expect(progress.completedAt).toBeDefined();
      expect(mockProgressRepo.save).toHaveBeenCalled();
    });
  });

  describe('analyzeFunnel', () => {
    it('throws NotFoundException for unknown funnel', async () => {
      mockFunnelRepo.findOne.mockResolvedValue(null);
      await expect(service.analyzeFunnel('bad-id')).rejects.toThrow('Funnel not found');
    });
  });
});
