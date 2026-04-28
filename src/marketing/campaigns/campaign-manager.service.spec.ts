import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignManagerService } from './campaign-manager.service';
import { Campaign, CampaignStatus, CampaignType } from './entities/campaign.entity';
import { CampaignTarget } from './entities/campaign-target.entity';
import { PerformanceTrackerService } from './services/performance-tracker.service';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  remove: jest.fn(),
  delete: jest.fn(),
});

describe('CampaignManagerService', () => {
  let service: CampaignManagerService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let targetRepo: ReturnType<typeof mockRepo>;
  let performanceTracker: { getSummary: jest.Mock };

  beforeEach(async () => {
    performanceTracker = { getSummary: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignManagerService,
        { provide: getRepositoryToken(Campaign), useFactory: mockRepo },
        { provide: getRepositoryToken(CampaignTarget), useFactory: mockRepo },
        { provide: PerformanceTrackerService, useValue: performanceTracker },
      ],
    }).compile();

    service = module.get(CampaignManagerService);
    campaignRepo = module.get(getRepositoryToken(Campaign));
    targetRepo = module.get(getRepositoryToken(CampaignTarget));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw BadRequestException when endDate is before startDate', async () => {
      await expect(
        service.create(
          {
            name: 'Test',
            region: 'US',
            type: CampaignType.PROMOTIONAL,
            startDate: '2025-12-01',
            endDate: '2025-11-01',
          },
          'user-id',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a campaign with valid dates', async () => {
      const dto = {
        name: 'Summer Sale',
        region: 'US',
        type: CampaignType.PROMOTIONAL,
        startDate: '2025-06-01',
        endDate: '2025-08-31',
      };
      const campaign = { id: 'uuid-1', ...dto } as unknown as Campaign;
      campaignRepo.create.mockReturnValue(campaign);
      campaignRepo.save.mockResolvedValue(campaign);

      const result = await service.create(dto, 'admin-id');

      expect(result).toEqual(campaign);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException when campaign does not exist', async () => {
      campaignRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('activate / pause / cancel', () => {
    it('should activate a campaign', async () => {
      const campaign = { id: 'uuid-1', status: CampaignStatus.DRAFT, targets: [], performance: [] } as Campaign;
      campaignRepo.findOne.mockResolvedValue(campaign);
      campaignRepo.save.mockResolvedValue({ ...campaign, status: CampaignStatus.ACTIVE });

      const result = await service.activate('uuid-1');
      expect(result.status).toBe(CampaignStatus.ACTIVE);
    });
  });
});
