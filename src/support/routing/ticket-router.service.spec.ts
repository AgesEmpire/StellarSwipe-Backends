import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TicketRouterService } from './ticket-router.service';
import { SupportTeam } from './entities/support-team.entity';
import { RoutingRule } from './entities/routing-rule.entity';
import { TeamMatcher } from './utils/team-matcher';
import { AvailabilityChecker } from './utils/availability-checker';
import { LanguageRoutingStrategy } from './strategies/language-routing.strategy';
import { TimezoneRoutingStrategy } from './strategies/timezone-routing.strategy';
import { SkillRoutingStrategy } from './strategies/skill-routing.strategy';
import { LoadBalancingStrategy } from './strategies/load-balancing.strategy';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
});

const makeTeam = (overrides: Partial<SupportTeam> = {}): SupportTeam => ({
  id: 'team-1',
  name: 'US Support',
  region: 'US',
  languages: ['en'],
  timezone: 'America/New_York',
  skills: ['trading', 'kyc'],
  maxCapacity: 10,
  currentLoad: 3,
  isActive: true,
  workingHours: {},
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('TicketRouterService', () => {
  let service: TicketRouterService;
  let teamRepo: ReturnType<typeof mockRepo>;
  let ruleRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketRouterService,
        { provide: getRepositoryToken(SupportTeam), useFactory: mockRepo },
        { provide: getRepositoryToken(RoutingRule), useFactory: mockRepo },
        TeamMatcher,
        AvailabilityChecker,
        LanguageRoutingStrategy,
        TimezoneRoutingStrategy,
        SkillRoutingStrategy,
        LoadBalancingStrategy,
      ],
    }).compile();

    service = module.get(TicketRouterService);
    teamRepo = module.get(getRepositoryToken(SupportTeam));
    ruleRepo = module.get(getRepositoryToken(RoutingRule));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('routeTicket', () => {
    it('should throw NotFoundException when no teams are available', async () => {
      teamRepo.find.mockResolvedValue([]);
      ruleRepo.find.mockResolvedValue([]);

      await expect(
        service.routeTicket({ ticketId: 'ticket-1', language: 'en' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should route to the best matching available team', async () => {
      const team = makeTeam();
      teamRepo.find.mockResolvedValue([team]);
      ruleRepo.find.mockResolvedValue([]);

      const result = await service.routeTicket({
        ticketId: 'ticket-1',
        language: 'en',
        region: 'US',
      });

      expect(result.ticketId).toBe('ticket-1');
      expect(result.teamId).toBe('team-1');
      expect(result.routingStrategy).toBe('composite_score');
    });

    it('should use routing rule when rule matches', async () => {
      const team = makeTeam();
      teamRepo.find.mockResolvedValue([team]);
      ruleRepo.find.mockResolvedValue([
        {
          id: 'rule-1',
          ruleType: 'language',
          conditions: { language: 'en' },
          isActive: true,
          priority: 10,
          targetTeam: team,
        },
      ]);

      const result = await service.routeTicket({ ticketId: 'ticket-2', language: 'en' });

      expect(result.routingRuleId).toBe('rule-1');
      expect(result.routingStrategy).toBe('language');
    });
  });

  describe('createTeam', () => {
    it('should create a support team', async () => {
      const dto = { name: 'EU Team', region: 'EU', languages: ['en', 'de'], timezone: 'Europe/Berlin', skills: ['trading'] };
      const team = { id: 'team-2', ...dto } as unknown as SupportTeam;
      teamRepo.create.mockReturnValue(team);
      teamRepo.save.mockResolvedValue(team);

      const result = await service.createTeam(dto as any);
      expect(result.region).toBe('EU');
    });
  });
});
