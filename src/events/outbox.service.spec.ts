import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OutboxService } from './outbox.service';
import { OutboxEvent } from './entities/outbox-event.entity';
import { EventEmitterService } from './event-emitter.service';

describe('OutboxService', () => {
  let service: OutboxService;
  let mockRepository: any;
  let mockEventEmitter: any;

  const makeEvent = (overrides: Partial<OutboxEvent> = {}): OutboxEvent =>
    ({
      id: 'evt-1',
      eventName: 'portfolio.transaction.created',
      payload: {},
      attempts: 0,
      publishedAt: undefined,
      deadAt: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as OutboxEvent);

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      save: jest.fn().mockImplementation(async (e) => e),
      create: jest.fn().mockImplementation((dto) => dto),
      getRepository: jest.fn(),
    };
    mockEventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: getRepositoryToken(OutboxEvent), useValue: mockRepository },
        { provide: EventEmitterService, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<OutboxService>(OutboxService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('publishPending', () => {
    it('should publish pending events and mark as published', async () => {
      const event = makeEvent();
      mockRepository.find.mockResolvedValue([event]);
      mockEventEmitter.emit.mockResolvedValue(undefined);

      await service.publishPending();

      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(event.publishedAt).toBeInstanceOf(Date);
      expect(event.attempts).toBe(1);
      expect(mockRepository.save).toHaveBeenCalledWith(event);
    });

    it('should increment attempts on failure and not mark as published', async () => {
      const event = makeEvent({ attempts: 0 });
      mockRepository.find.mockResolvedValue([event]);
      mockEventEmitter.emit.mockRejectedValue(new Error('emit failed'));

      await service.publishPending();

      expect(event.publishedAt).toBeUndefined();
      expect(event.attempts).toBe(1);
      expect(event.deadAt).toBeUndefined();
    });

    it('should mark event as DEAD after 5 failed attempts', async () => {
      const event = makeEvent({ attempts: 4 });
      mockRepository.find.mockResolvedValue([event]);
      mockEventEmitter.emit.mockRejectedValue(new Error('emit failed'));

      await service.publishPending();

      expect(event.attempts).toBe(5);
      expect(event.deadAt).toBeInstanceOf(Date);
      expect(event.publishedAt).toBeUndefined();
    });

    it('should skip dead events (not returned by query)', async () => {
      mockRepository.find.mockResolvedValue([]);

      await service.publishPending();

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should do nothing when no pending events', async () => {
      mockRepository.find.mockResolvedValue([]);

      await service.publishPending();

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });
});
