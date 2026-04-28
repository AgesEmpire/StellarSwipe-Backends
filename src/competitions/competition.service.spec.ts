import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { CompetitionService } from './competition.service';
import { ScoringEngineService } from './services/scoring-engine.service';
import { Competition } from './entities/competition.entity';
import { Participant } from './entities/participant.entity';
import { CompetitionTrade } from './entities/competition-trade.entity';
import { PrizePool } from './entities/prize-pool.entity';
import { User } from '../users/entities/user.entity';
import { CompetitionStatus } from './entities/competition.entity';

describe('CompetitionService', () => {
  let service: CompetitionService;
  const mockCompetitionRepo = {
    create: jest.fn((x) => ({ id: 'comp-1', ...x })),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(async ({ where }) => ({
      id: where.id,
      prizePool: { id: 'pool-1' },
    })),
    find: jest.fn(),
  };
  const mockParticipantRepo = {
    create: jest.fn((x) => ({ id: 'part-1', ...x })),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  };
  const mockTradeRepo = {
    create: jest.fn((x) => ({ id: 'trade-1', ...x })),
    save: jest.fn(async (x) => x),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  };
  const mockPoolRepo = {
    create: jest.fn((x) => ({ id: 'pool-1', ...x })),
    save: jest.fn(async (x) => x),
  };
  const mockUserRepo = {
    findOne: jest.fn(async () => ({ id: 'user-1', username: 'alice' })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionService,
        ScoringEngineService,
        { provide: getRepositoryToken(Competition), useValue: mockCompetitionRepo },
        { provide: getRepositoryToken(Participant), useValue: mockParticipantRepo },
        { provide: getRepositoryToken(CompetitionTrade), useValue: mockTradeRepo },
        { provide: getRepositoryToken(PrizePool), useValue: mockPoolRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(CompetitionService);
  });

  it('rejects create when endsAt <= startsAt', async () => {
    const starts = new Date('2030-01-01');
    const ends = new Date('2029-01-01');
    await expect(
      service.create({
        name: 'X',
        startsAt: starts,
        endsAt: ends,
        prizePoolTotal: '100',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('join requires LIVE status', async () => {
    mockCompetitionRepo.findOne.mockResolvedValueOnce({
      id: 'c1',
      status: CompetitionStatus.SCHEDULED,
      prizePool: {},
    });
    await expect(service.join('c1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
