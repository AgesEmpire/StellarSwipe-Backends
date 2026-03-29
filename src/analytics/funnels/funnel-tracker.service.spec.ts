import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FunnelTrackerService } from './funnel-tracker.service';
import { Funnel } from './entities/funnel.entity';
import { UserFunnelProgress } from './entities/user-funnel-progress.entity';
import { USER_ACQUISITION_FUNNEL } from './interfaces/funnel-step.interface';

const mockFunnel: Funnel = {
  id: 'funnel-1',
  name: USER_ACQUISITION_FUNNEL.name,
  steps: USER_ACQUISITION_FUNNEL.steps,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProgress: UserFunnelProgress = {
  id: 'progress-1',
  userId: 'user-1',
  funnelName: USER_ACQUISITION_FUNNEL.name,
  currentStep: 'signup',
  completedSteps: [{ key: 'signup', completedAt: new Date().toISOString() }],
  isConverted: false,
  droppedAtStep: undefined,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('FunnelTrackerService', () => {
  let service: FunnelTrackerService;
  let funnelRepo: jest.Mocked<Repository<Funnel>>;
  let progressRepo: jest.Mocked<Repository<UserFunnelProgress>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FunnelTrackerService,
        {
          provide: getRepositoryToken(Funnel),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserFunnelProgress),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(FunnelTrackerService);
    funnelRepo = module.get(getRepositoryToken(Funnel));
    progressRepo = module.get(getRepositoryToken(UserFunnelProgress));

    funnelRepo.findOne.mockResolvedValue(mockFunnel);
    funnelRepo.create.mockReturnValue(mockFunnel);
    funnelRepo.save.mockResolvedValue(mockFunnel);
  });

  it('should track a funnel step for a new user', async () => {
    progressRepo.findOne.mockResolvedValue(null);
    progressRepo.create.mockReturnValue({ ...mockProgress });
    progressRepo.save.mockResolvedValue({ ...mockProgress });

    const result = await service.trackStep({
      userId: 'user-1',
      funnelName: USER_ACQUISITION_FUNNEL.name,
      stepKey: 'signup',
    });

    expect(progressRepo.save).toHaveBeenCalled();
    expect(result.userId).toBe('user-1');
  });

  it('should mark user as converted on last step', async () => {
    const inProgress = { ...mockProgress, completedSteps: [] };
    progressRepo.findOne.mockResolvedValue(inProgress);
    progressRepo.save.mockImplementation(async (p) => p as UserFunnelProgress);

    const result = await service.trackStep({
      userId: 'user-1',
      funnelName: USER_ACQUISITION_FUNNEL.name,
      stepKey: 'first_trade',
    });

    expect(result.isConverted).toBe(true);
  });

  it('should analyze funnel and return conversion rates', async () => {
    progressRepo.find.mockResolvedValue([
      { ...mockProgress, completedSteps: [{ key: 'signup', completedAt: '' }, { key: 'wallet_connect', completedAt: '' }] },
      { ...mockProgress, id: 'p2', completedSteps: [{ key: 'signup', completedAt: '' }] },
    ]);

    const result = await service.analyzeFunnel({ funnelName: USER_ACQUISITION_FUNNEL.name });

    expect(result.totalEntries).toBe(2);
    expect(result.steps.find((s) => s.stepKey === 'signup')?.usersReached).toBe(2);
    expect(result.steps.find((s) => s.stepKey === 'wallet_connect')?.usersReached).toBe(1);
  });

  it('should return null for unknown user progress', async () => {
    progressRepo.findOne.mockResolvedValue(null);
    const result = await service.getUserProgress('unknown', USER_ACQUISITION_FUNNEL.name);
    expect(result).toBeNull();
  });
});
