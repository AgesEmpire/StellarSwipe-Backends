import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { SandboxManagerService } from './sandbox-manager.service';
import { SandboxEnvironment, SandboxStatus, SandboxTier } from './entities/sandbox-environment.entity';
import { TestDataSnapshot, SnapshotType } from './entities/test-data-snapshot.entity';
import { TestDataGeneratorService } from './services/test-data-generator.service';
import { MockProviderService } from './services/mock-provider.service';
import { SandboxIsolatorService } from './services/sandbox-isolator.service';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { ResetSandboxDto, ResetStrategy } from './dto/reset-sandbox.dto';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeSandbox(overrides: Partial<SandboxEnvironment> = {}): SandboxEnvironment {
  return {
    id: 'sandbox-uuid-1',
    name: 'test-sandbox',
    ownerId: 'owner-uuid-1',
    status: SandboxStatus.ACTIVE,
    tier: SandboxTier.STANDARD,
    description: null,
    schemaPrefix: 'sbx_testsan_ab12',
    stellarPublicKey: null,
    stellarSecretKey: null,
    activeSnapshotId: null,
    featureFlags: {},
    mockConfig: {},
    resetCount: 0,
    lastResetAt: null,
    ttlSeconds: null,
    expiresAt: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    snapshots: [],
    ...overrides,
  } as SandboxEnvironment;
}

function makeSnapshot(overrides: Partial<TestDataSnapshot> = {}): TestDataSnapshot {
  return {
    id: 'snap-uuid-1',
    environmentId: 'sandbox-uuid-1',
    label: 'Initial seed',
    type: SnapshotType.SEEDED,
    tables: [],
    stellarState: null,
    dumpReference: null,
    diffFromPrevious: null,
    totalRows: 100,
    isRestorable: true,
    createdByUserId: null,
    metadata: {},
    createdAt: new Date(),
    environment: {} as SandboxEnvironment,
    ...overrides,
  } as TestDataSnapshot;
}

// ─── Mock repository factory ──────────────────────────────────────────────────

function mockRepository<T>(): jest.Mocked<Repository<T>> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SandboxManagerService', () => {
  let service: SandboxManagerService;
  let sandboxRepo: jest.Mocked<Repository<SandboxEnvironment>>;
  let snapshotRepo: jest.Mocked<Repository<TestDataSnapshot>>;
  let testDataGenerator: jest.Mocked<TestDataGeneratorService>;
  let mockProvider: jest.Mocked<MockProviderService>;
  let isolator: jest.Mocked<SandboxIsolatorService>;

  beforeEach(async () => {
    sandboxRepo = mockRepository<SandboxEnvironment>();
    snapshotRepo = mockRepository<TestDataSnapshot>();

    testDataGenerator = {
      generateAll: jest.fn().mockResolvedValue({ totalRows: 155, durationMs: 120 }),
      getScenario: jest.fn(),
      tierToScenario: jest.fn(),
    } as any;

    mockProvider = {
      initForSandbox: jest.fn(),
      clearForSandbox: jest.fn(),
      clearCapturedEmails: jest.fn(),
      clearCapturedNotifications: jest.fn(),
      updateConfig: jest.fn(),
      enableChaosMode: jest.fn(),
      disableChaosMode: jest.fn(),
    } as any;

    isolator = {
      generateSchemaPrefix: jest.fn().mockReturnValue('sbx_testsan_ab12'),
      truncateSandboxData: jest.fn().mockResolvedValue(undefined),
      captureReport: jest.fn().mockResolvedValue({
        sandboxId: 'sandbox-uuid-1',
        schemaPrefix: 'sbx_testsan_ab12',
        tables: [{ name: 'users', rowCount: 50, checksum: 'abc123' }],
        totalRows: 50,
        capturedAt: new Date().toISOString(),
      }),
      ensureSandboxColumns: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SandboxManagerService,
        { provide: getRepositoryToken(SandboxEnvironment), useValue: sandboxRepo },
        { provide: getRepositoryToken(TestDataSnapshot), useValue: snapshotRepo },
        { provide: getDataSourceToken(), useValue: {} as DataSource },
        { provide: TestDataGeneratorService, useValue: testDataGenerator },
        { provide: MockProviderService, useValue: mockProvider },
        { provide: SandboxIsolatorService, useValue: isolator },
      ],
    }).compile();

    service = module.get<SandboxManagerService>(SandboxManagerService);
  });

  // ─── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('should call ensureSandboxColumns on init', async () => {
      await service.onModuleInit();
      expect(isolator.ensureSandboxColumns).toHaveBeenCalledTimes(1);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateSandboxDto = {
      name: 'test-sandbox',
      tier: SandboxTier.STANDARD,
    };

    it('should create a sandbox successfully', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(null);
      sandboxRepo.create.mockReturnValue(sandbox);
      sandboxRepo.save.mockResolvedValue(sandbox);
      snapshotRepo.create.mockReturnValue(makeSnapshot());
      snapshotRepo.save.mockResolvedValue(makeSnapshot());
      snapshotRepo.count.mockResolvedValue(1);

      const result = await service.create('owner-uuid-1', dto);

      expect(sandboxRepo.save).toHaveBeenCalled();
      expect(testDataGenerator.generateAll).toHaveBeenCalledWith(sandbox, undefined);
      expect(mockProvider.initForSandbox).toHaveBeenCalledWith(sandbox.id);
      expect(result.id).toBe(sandbox.id);
      expect(result.status).toBe(SandboxStatus.ACTIVE);
    });

    it('should throw ConflictException if sandbox name already exists', async () => {
      sandboxRepo.findOne.mockResolvedValue(makeSandbox());

      await expect(service.create('owner-uuid-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should set SUSPENDED status if seed fails', async () => {
      const sandbox = makeSandbox({ status: SandboxStatus.INITIALIZING });
      sandboxRepo.findOne.mockResolvedValue(null);
      sandboxRepo.create.mockReturnValue(sandbox);
      sandboxRepo.save.mockResolvedValue(sandbox);
      testDataGenerator.generateAll.mockRejectedValue(new Error('Seed failed'));

      await expect(service.create('owner-uuid-1', dto)).rejects.toThrow('Seed failed');
      expect(sandbox.status).toBe(SandboxStatus.SUSPENDED);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return sandbox status dto', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      snapshotRepo.count.mockResolvedValue(3);

      const result = await service.findOne(sandbox.id);

      expect(result.id).toBe(sandbox.id);
      expect(result.snapshotCount).toBe(3);
      expect(result.isExpired).toBe(false);
    });

    it('should throw NotFoundException for unknown id', async () => {
      sandboxRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('should mark expired sandboxes correctly', async () => {
      const sandbox = makeSandbox({
        expiresAt: new Date(Date.now() - 1000),
      });
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      snapshotRepo.count.mockResolvedValue(0);

      const result = await service.findOne(sandbox.id);
      expect(result.isExpired).toBe(true);
    });
  });

  // ─── destroy ──────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should truncate data and clear mock config on destroy', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      sandboxRepo.save.mockResolvedValue(sandbox);
      sandboxRepo.remove.mockResolvedValue(sandbox);

      await service.destroy(sandbox.id);

      expect(isolator.truncateSandboxData).toHaveBeenCalledWith(sandbox.schemaPrefix);
      expect(mockProvider.clearForSandbox).toHaveBeenCalledWith(sandbox.id);
      expect(sandboxRepo.remove).toHaveBeenCalled();
    });
  });

  // ─── reset ────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should perform a FULL reset successfully', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      sandboxRepo.save.mockResolvedValue(sandbox);
      snapshotRepo.create.mockReturnValue(makeSnapshot());
      snapshotRepo.save.mockResolvedValue(makeSnapshot());

      const dto: ResetSandboxDto = {
        strategy: ResetStrategy.FULL,
        capturePreResetSnapshot: false,
      };

      const result = await service.reset(sandbox.id, dto);

      expect(isolator.truncateSandboxData).toHaveBeenCalledWith(sandbox.schemaPrefix);
      expect(testDataGenerator.generateAll).toHaveBeenCalled();
      expect(result.resetCount).toBeGreaterThan(0);
      expect(result.status).toBe(SandboxStatus.ACTIVE);
    });

    it('should capture pre-reset snapshot when requested', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      sandboxRepo.save.mockResolvedValue(sandbox);
      snapshotRepo.create.mockReturnValue(makeSnapshot({ type: SnapshotType.PRE_RESET }));
      snapshotRepo.save.mockResolvedValue(makeSnapshot());

      const dto: ResetSandboxDto = {
        strategy: ResetStrategy.FULL,
        capturePreResetSnapshot: true,
        snapshotLabel: 'My pre-reset snap',
      };

      await service.reset(sandbox.id, dto);
      expect(snapshotRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if already resetting', async () => {
      const sandbox = makeSandbox({ status: SandboxStatus.RESETTING });
      sandboxRepo.findOne.mockResolvedValue(sandbox);

      await expect(
        service.reset(sandbox.id, { strategy: ResetStrategy.FULL }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw for FROM_SNAPSHOT without snapshotId', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      sandboxRepo.save.mockResolvedValue(sandbox);

      await expect(
        service.reset(sandbox.id, { strategy: ResetStrategy.FROM_SNAPSHOT }),
      ).rejects.toThrow();
    });
  });

  // ─── snapshots ────────────────────────────────────────────────────────────

  describe('listSnapshots', () => {
    it('should return snapshots for a sandbox', async () => {
      const sandbox = makeSandbox();
      const snapshots = [makeSnapshot(), makeSnapshot({ id: 'snap-2' })];
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      snapshotRepo.find.mockResolvedValue(snapshots);

      const result = await service.listSnapshots(sandbox.id);
      expect(result).toHaveLength(2);
    });
  });

  describe('deleteSnapshot', () => {
    it('should delete an existing snapshot', async () => {
      const snapshot = makeSnapshot();
      snapshotRepo.findOne.mockResolvedValue(snapshot);
      snapshotRepo.remove.mockResolvedValue(snapshot);

      await service.deleteSnapshot('sandbox-uuid-1', snapshot.id);
      expect(snapshotRepo.remove).toHaveBeenCalledWith(snapshot);
    });

    it('should throw NotFoundException for missing snapshot', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      await expect(
        service.deleteSnapshot('sandbox-uuid-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── feature flags ────────────────────────────────────────────────────────

  describe('setFeatureFlag', () => {
    it('should toggle a feature flag', async () => {
      const sandbox = makeSandbox();
      sandboxRepo.findOne.mockResolvedValue(sandbox);
      sandboxRepo.save.mockResolvedValue({ ...sandbox, featureFlags: { newFlow: true } });
      snapshotRepo.count.mockResolvedValue(0);

      const result = await service.setFeatureFlag(sandbox.id, 'newFlow', true);
      expect(result.featureFlags['newFlow']).toBe(true);
    });
  });

  // ─── TTL expiry ───────────────────────────────────────────────────────────

  describe('purgeExpiredSandboxes', () => {
    it('should destroy all expired sandboxes', async () => {
      const expired = [
        makeSandbox({ id: 'exp-1', expiresAt: new Date(Date.now() - 1000) }),
        makeSandbox({ id: 'exp-2', expiresAt: new Date(Date.now() - 2000) }),
      ];

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(expired),
      };
      sandboxRepo.createQueryBuilder.mockReturnValue(qb as any);
      sandboxRepo.findOne
        .mockResolvedValueOnce(expired[0])
        .mockResolvedValueOnce(expired[1]);
      sandboxRepo.save.mockResolvedValue({} as SandboxEnvironment);
      sandboxRepo.remove.mockResolvedValue({} as SandboxEnvironment);

      await service.purgeExpiredSandboxes();

      expect(isolator.truncateSandboxData).toHaveBeenCalledTimes(2);
    });
  });
});
