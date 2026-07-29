import { Test, TestingModule } from '@nestjs/testing';
import { PositionArchiveService } from './position-archive.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Position } from '../entities/position.entity';
import { ArchivedPosition } from '../entities/archived-position.entity';
import { CopiedPosition, PositionStatus } from '../../signals/entities/copied-position.entity';
import { ConfigService } from '@nestjs/config';

describe('PositionArchiveService', () => {
  let service: PositionArchiveService;
  let positionRepository: { findAndCount: jest.Mock; findOne: jest.Mock; remove: jest.Mock; create: jest.Mock; save: jest.Mock };
  let archivedPositionRepository: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let copiedPositionRepository: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    positionRepository = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    archivedPositionRepository = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };
    copiedPositionRepository = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionArchiveService,
        {
          provide: getRepositoryToken(Position),
          useValue: positionRepository,
        },
        {
          provide: getRepositoryToken(ArchivedPosition),
          useValue: archivedPositionRepository,
        },
        {
          provide: getRepositoryToken(CopiedPosition),
          useValue: copiedPositionRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => defaultValue),
          },
        },
      ],
    }).compile();

    service = module.get<PositionArchiveService>(PositionArchiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('archiveClosedPositions', () => {
    it('should identify closed positions older than retention window', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120);

      const mockPosition = {
        id: 'pos-1',
        userId: 'user-1',
        tradeId: 'trade-1',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        side: 'BUY',
        amount: '100',
        entryPrice: '0.1',
        currentPrice: '0.2',
        unrealizedPnL: '10',
        isActive: false,
        updatedAt: oldDate,
      };

      positionRepository.findAndCount.mockResolvedValue([[mockPosition], 1]);
      archivedPositionRepository.findOne.mockResolvedValue(null);
      archivedPositionRepository.create.mockReturnValue({ id: 'archived-pos-1' });
      archivedPositionRepository.save.mockResolvedValue({ id: 'archived-pos-1' });

      const result = await service.archiveClosedPositions(90);

      expect(result.eligible).toBe(1);
      expect(positionRepository.findAndCount).toHaveBeenCalledWith({
        where: { isActive: false, updatedAt: expect.any(Date) },
      });
    });

    it('should skip already archived positions', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120);

      const mockPosition = {
        id: 'pos-1',
        userId: 'user-1',
        tradeId: 'trade-1',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        side: 'BUY',
        amount: '100',
        entryPrice: '0.1',
        currentPrice: '0.2',
        unrealizedPnL: '10',
        isActive: false,
        updatedAt: oldDate,
      };

      positionRepository.findAndCount.mockResolvedValue([[mockPosition], 1]);
      archivedPositionRepository.findOne.mockResolvedValue({ id: 'archived-pos-existing' });

      const result = await service.archiveClosedPositions(90);

      expect(result.archived).toBe(0);
      expect(archivedPositionRepository.save).not.toHaveBeenCalled();
    });

    it('should archive positions to cold storage and remove from hot table', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120);

      const mockPosition = {
        id: 'pos-1',
        userId: 'user-1',
        tradeId: 'trade-1',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        side: 'BUY',
        amount: '100',
        entryPrice: '0.1',
        currentPrice: '0.2',
        unrealizedPnL: '10',
        isActive: false,
        updatedAt: oldDate,
      };

      positionRepository.findAndCount.mockResolvedValue([[mockPosition], 1]);
      archivedPositionRepository.findOne.mockResolvedValue(null);
      archivedPositionRepository.create.mockReturnValue({ id: 'archived-pos-1', originalPositionId: 'pos-1' });
      archivedPositionRepository.save.mockResolvedValue({ id: 'archived-pos-1' });

      const result = await service.archiveClosedPositions(90);

      expect(result.archived).toBe(1);
      expect(archivedPositionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalPositionId: mockPosition.id,
          userId: mockPosition.userId,
          tradeId: mockPosition.tradeId,
        }),
      );
      expect(positionRepository.remove).toHaveBeenCalledWith(mockPosition);
    });
  });

  describe('archiveClosedCopiedPositions', () => {
    it('should identify closed copied positions older than retention window', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120);

      const mockCopiedPosition = {
        id: 'copied-pos-1',
        signalId: 'signal-1',
        userId: 'user-1',
        status: PositionStatus.CLOSED,
        closedAt: oldDate,
        pnlAbsolute: '50',
      };

      copiedPositionRepository.findAndCount.mockResolvedValue([[mockCopiedPosition], 1]);

      const result = await service.archiveClosedCopiedPositions(90);

      expect(result.eligible).toBe(1);
      expect(copiedPositionRepository.findAndCount).toHaveBeenCalledWith({
        where: { status: PositionStatus.CLOSED, closedAt: expect.any(Date) },
      });
    });

    it('should archive copied positions to cold storage', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 120);

      const mockCopiedPosition = {
        id: 'copied-pos-1',
        signalId: 'signal-1',
        userId: 'user-1',
        status: PositionStatus.CLOSED,
        closedAt: oldDate,
        pnlAbsolute: '50',
      };

      copiedPositionRepository.findAndCount.mockResolvedValue([[mockCopiedPosition], 1]);
      archivedPositionRepository.create.mockReturnValue({ id: 'archived-pos-1' });
      archivedPositionRepository.save.mockResolvedValue({ id: 'archived-pos-1' });

      const result = await service.archiveClosedCopiedPositions(90);

      expect(result.archived).toBe(1);
      expect(archivedPositionRepository.save).toHaveBeenCalled();
      expect(copiedPositionRepository.remove).toHaveBeenCalledWith(mockCopiedPosition);
    });
  });

  describe('getArchivedPositions', () => {
    it('should retrieve archived positions for a user within date range', async () => {
      const mockArchivedPositions = [
        { id: 'archived-1', userId: 'user-1', closedAt: new Date('2024-01-15') },
      ];

      archivedPositionRepository.find.mockResolvedValue(mockArchivedPositions);

      const result = await service.getArchivedPositions('user-1', new Date('2024-01-01'), new Date('2024-01-31'));

      expect(result).toEqual(mockArchivedPositions);
      expect(archivedPositionRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', closedAt: expect.any(Object) },
        order: { closedAt: 'DESC' },
      });
    });

    it('should retrieve archived positions without date filter', async () => {
      const mockArchivedPositions = [
        { id: 'archived-1', userId: 'user-1', closedAt: new Date('2024-01-15') },
      ];

      archivedPositionRepository.find.mockResolvedValue(mockArchivedPositions);

      const result = await service.getArchivedPositions('user-1');

      expect(result).toEqual(mockArchivedPositions);
      expect(archivedPositionRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { closedAt: 'DESC' },
      });
    });
  });

  describe('restoreArchivedPosition', () => {
    it('should restore an archived position to active positions', async () => {
      const mockArchived = {
        id: 'archived-1',
        userId: 'user-1',
        tradeId: 'trade-1',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        side: 'BUY',
        amount: '100',
        entryPrice: '0.1',
        exitPrice: '0.2',
        realizedPnL: '10',
      };

      archivedPositionRepository.findOne.mockResolvedValue(mockArchived);
      positionRepository.create.mockReturnValue({ id: 'restored-pos-1' });
      positionRepository.save.mockResolvedValue({ id: 'restored-pos-1' });

      const result = await service.restoreArchivedPosition('archived-1');

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-1');
      expect(result.isActive).toBe(false);
      expect(archivedPositionRepository.remove).toHaveBeenCalledWith(mockArchived);
    });

    it('should return null for non-existent archived position', async () => {
      archivedPositionRepository.findOne.mockResolvedValue(null);

      const result = await service.restoreArchivedPosition('non-existent');

      expect(result).toBeNull();
    });
  });
});