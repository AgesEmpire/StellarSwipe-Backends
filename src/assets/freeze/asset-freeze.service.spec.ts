import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AssetFreezeService } from './asset-freeze.service';
import { AssetFreeze, FreezeReason, FreezeStatus } from './entities/asset-freeze.entity';
import { FreezeAssetDto, UnfreezeAssetDto } from './dto/freeze-asset.dto';

const ADMIN_ID = 'admin-uuid-1';
const ASSET_ID = 'asset-uuid-1';

const mockFreezeRecord = (): AssetFreeze => ({
  id: 'freeze-uuid-1',
  assetId: ASSET_ID,
  status: FreezeStatus.FROZEN,
  reason: FreezeReason.SECURITY,
  description: 'Suspicious activity',
  initiatedBy: ADMIN_ID,
  frozenAt: new Date('2024-01-01T10:00:00Z'),
  unfrozenAt: null,
  createdAt: new Date('2024-01-01T10:00:00Z'),
  updatedAt: new Date('2024-01-01T10:00:00Z'),
});

describe('AssetFreezeService', () => {
  let service: AssetFreezeService;
  let repo: jest.Mocked<Repository<AssetFreeze>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetFreezeService,
        {
          provide: getRepositoryToken(AssetFreeze),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AssetFreezeService>(AssetFreezeService);
    repo = module.get(getRepositoryToken(AssetFreeze));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── freezeAsset ──────────────────────────────────────────────────────────

  describe('freezeAsset', () => {
    it('creates a freeze record for an unfrozen asset', async () => {
      repo.findOne.mockResolvedValue(null); // not currently frozen
      const freeze = mockFreezeRecord();
      repo.create.mockReturnValue(freeze);
      repo.save.mockResolvedValue(freeze);

      const dto: FreezeAssetDto = {
        assetId: ASSET_ID,
        reason: FreezeReason.SECURITY,
        description: 'Suspicious activity',
      };

      const result = await service.freezeAsset(dto, ADMIN_ID);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: ASSET_ID,
          status: FreezeStatus.FROZEN,
          reason: FreezeReason.SECURITY,
          initiatedBy: ADMIN_ID,
        }),
      );
      expect(result.status).toBe(FreezeStatus.FROZEN);
      expect(result.assetId).toBe(ASSET_ID);
    });

    it('throws BadRequestException if asset is already frozen', async () => {
      repo.findOne.mockResolvedValue(mockFreezeRecord());

      const dto: FreezeAssetDto = {
        assetId: ASSET_ID,
        reason: FreezeReason.REGULATORY,
      };

      await expect(service.freezeAsset(dto, ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets frozenAt timestamp on freeze', async () => {
      repo.findOne.mockResolvedValue(null);
      const freeze = mockFreezeRecord();
      repo.create.mockReturnValue(freeze);
      repo.save.mockResolvedValue(freeze);

      const dto: FreezeAssetDto = { assetId: ASSET_ID, reason: FreezeReason.COMPLIANCE };
      const result = await service.freezeAsset(dto, ADMIN_ID);

      expect(result.frozenAt).toBeInstanceOf(Date);
    });
  });

  // ─── unfreezeAsset ────────────────────────────────────────────────────────

  describe('unfreezeAsset', () => {
    it('unfreezes a currently frozen asset', async () => {
      const freeze = mockFreezeRecord();
      repo.findOne.mockResolvedValue(freeze);
      repo.save.mockImplementation(async (f) => f as AssetFreeze);

      const dto: UnfreezeAssetDto = {
        assetId: ASSET_ID,
        description: 'Investigation complete',
      };

      const result = await service.unfreezeAsset(dto, ADMIN_ID);

      expect(result.status).toBe(FreezeStatus.UNFROZEN);
      expect(result.unfrozenAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException if asset is not frozen', async () => {
      repo.findOne.mockResolvedValue(null);

      const dto: UnfreezeAssetDto = { assetId: ASSET_ID };

      await expect(service.unfreezeAsset(dto, ADMIN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('records the admin who performed the unfreeze', async () => {
      const freeze = mockFreezeRecord();
      repo.findOne.mockResolvedValue(freeze);
      repo.save.mockImplementation(async (f) => f as AssetFreeze);

      const dto: UnfreezeAssetDto = { assetId: ASSET_ID };
      const result = await service.unfreezeAsset(dto, 'admin-uuid-2');

      expect(result.initiatedBy).toBe('admin-uuid-2');
    });
  });

  // ─── checkFreezeStatus ────────────────────────────────────────────────────

  describe('checkFreezeStatus', () => {
    it('returns isFrozen=true with active freeze record when frozen', async () => {
      repo.findOne.mockResolvedValue(mockFreezeRecord());

      const result = await service.checkFreezeStatus(ASSET_ID);

      expect(result.isFrozen).toBe(true);
      expect(result.activeFreeze).not.toBeNull();
      expect(result.activeFreeze?.assetId).toBe(ASSET_ID);
    });

    it('returns isFrozen=false with null activeFreeze when not frozen', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.checkFreezeStatus(ASSET_ID);

      expect(result.isFrozen).toBe(false);
      expect(result.activeFreeze).toBeNull();
    });
  });

  // ─── isFrozen ─────────────────────────────────────────────────────────────

  describe('isFrozen', () => {
    it('returns true when an active freeze record exists', async () => {
      repo.findOne.mockResolvedValue(mockFreezeRecord());

      expect(await service.isFrozen(ASSET_ID)).toBe(true);
    });

    it('returns false when no active freeze record exists', async () => {
      repo.findOne.mockResolvedValue(null);

      expect(await service.isFrozen(ASSET_ID)).toBe(false);
    });
  });

  // ─── getFreezeHistory ─────────────────────────────────────────────────────

  describe('getFreezeHistory', () => {
    it('returns all freeze records for an asset ordered by createdAt DESC', async () => {
      const records = [
        { ...mockFreezeRecord(), id: 'freeze-2', status: FreezeStatus.UNFROZEN },
        mockFreezeRecord(),
      ];
      repo.find.mockResolvedValue(records as AssetFreeze[]);

      const result = await service.getFreezeHistory(ASSET_ID);

      expect(repo.find).toHaveBeenCalledWith({
        where: { assetId: ASSET_ID },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
    });

    it('returns an empty array when no history exists', async () => {
      repo.find.mockResolvedValue([]);

      const result = await service.getFreezeHistory(ASSET_ID);

      expect(result).toEqual([]);
    });
  });

  // ─── Freeze state enforcement ─────────────────────────────────────────────

  describe('freeze state enforcement', () => {
    it('prevents double-freeze on the same asset', async () => {
      repo.findOne.mockResolvedValue(mockFreezeRecord());

      const dto: FreezeAssetDto = { assetId: ASSET_ID, reason: FreezeReason.ADMIN };

      await expect(service.freezeAsset(dto, ADMIN_ID)).rejects.toThrow(BadRequestException);
    });

    it('allows re-freeze after unfreeze', async () => {
      // First call: no active freeze (asset was unfrozen)
      repo.findOne.mockResolvedValue(null);
      const freeze = mockFreezeRecord();
      repo.create.mockReturnValue(freeze);
      repo.save.mockResolvedValue(freeze);

      const dto: FreezeAssetDto = { assetId: ASSET_ID, reason: FreezeReason.SECURITY };
      const result = await service.freezeAsset(dto, ADMIN_ID);

      expect(result.status).toBe(FreezeStatus.FROZEN);
    });
  });
});
