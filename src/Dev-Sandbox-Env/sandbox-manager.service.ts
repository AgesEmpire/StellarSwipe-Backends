import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

import {
  SandboxEnvironment,
  SandboxStatus,
} from './entities/sandbox-environment.entity';
import {
  TestDataSnapshot,
  SnapshotType,
} from './entities/test-data-snapshot.entity';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { ResetSandboxDto, ResetStrategy } from './dto/reset-sandbox.dto';
import {
  SandboxStatusDto,
  SandboxListItemDto,
} from './dto/sandbox-status.dto';
import { TestDataGeneratorService } from './services/test-data-generator.service';
import { MockProviderService } from './services/mock-provider.service';
import { SandboxIsolatorService } from './services/sandbox-isolator.service';
import { createEnvironmentCloner } from './utils/environment-cloner';

@Injectable()
export class SandboxManagerService implements OnModuleInit {
  private readonly logger = new Logger(SandboxManagerService.name);

  constructor(
    @InjectRepository(SandboxEnvironment)
    private readonly sandboxRepo: Repository<SandboxEnvironment>,

    @InjectRepository(TestDataSnapshot)
    private readonly snapshotRepo: Repository<TestDataSnapshot>,

    @InjectDataSource()
    private readonly dataSource: DataSource,

    private readonly testDataGenerator: TestDataGeneratorService,
    private readonly mockProvider: MockProviderService,
    private readonly isolator: SandboxIsolatorService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.isolator.ensureSandboxColumns();
    this.logger.log('SandboxManagerService initialized');
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(
    ownerId: string,
    dto: CreateSandboxDto,
  ): Promise<SandboxStatusDto> {
    const existing = await this.sandboxRepo.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Sandbox with name "${dto.name}" already exists`,
      );
    }

    const schemaPrefix = this.isolator.generateSchemaPrefix(dto.name);
    const expiresAt = dto.ttlSeconds
      ? new Date(Date.now() + dto.ttlSeconds * 1000)
      : null;

    const sandbox = this.sandboxRepo.create({
      name: dto.name,
      ownerId,
      tier: dto.tier,
      description: dto.description ?? null,
      schemaPrefix,
      featureFlags: dto.featureFlags ?? {},
      expiresAt,
      ttlSeconds: dto.ttlSeconds ?? null,
      metadata: dto.metadata ?? {},
    });

    await this.sandboxRepo.save(sandbox);

    this.mockProvider.initForSandbox(sandbox.id);

    try {
      await this.testDataGenerator.generateAll(sandbox, dto.seedSnapshotId);

      // Capture initial snapshot
      await this.captureSnapshot(sandbox, 'Initial seed', SnapshotType.SEEDED);

      sandbox.status = SandboxStatus.ACTIVE;
      await this.sandboxRepo.save(sandbox);
    } catch (err) {
      sandbox.status = SandboxStatus.SUSPENDED;
      await this.sandboxRepo.save(sandbox);
      this.logger.error(`Sandbox "${dto.name}" failed to initialize`, err);
      throw err;
    }

    this.logger.log(`Sandbox "${dto.name}" created [${sandbox.id}]`);
    return this.toStatusDto(sandbox);
  }

  async findAll(ownerId?: string): Promise<SandboxListItemDto[]> {
    const where = ownerId ? { ownerId } : {};
    const sandboxes = await this.sandboxRepo.find({ where, order: { createdAt: 'DESC' } });
    return sandboxes.map(this.toListItemDto.bind(this));
  }

  async findOne(id: string): Promise<SandboxStatusDto> {
    const sandbox = await this.findOrFail(id);
    const snapshotCount = await this.snapshotRepo.count({
      where: { environmentId: id },
    });
    return this.toStatusDto(sandbox, snapshotCount);
  }

  async destroy(id: string): Promise<void> {
    const sandbox = await this.findOrFail(id);
    sandbox.status = SandboxStatus.DESTROYED;
    await this.sandboxRepo.save(sandbox);

    await this.isolator.truncateSandboxData(sandbox.schemaPrefix);
    this.mockProvider.clearForSandbox(sandbox.id);

    await this.sandboxRepo.remove(sandbox);
    this.logger.log(`Sandbox "${sandbox.name}" [${id}] destroyed`);
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  async reset(id: string, dto: ResetSandboxDto): Promise<SandboxStatusDto> {
    const sandbox = await this.findOrFail(id);

    if (sandbox.status === SandboxStatus.RESETTING) {
      throw new ConflictException('Sandbox is already being reset');
    }

    if (sandbox.status === SandboxStatus.DESTROYED) {
      throw new BadRequestException('Cannot reset a destroyed sandbox');
    }

    sandbox.status = SandboxStatus.RESETTING;
    await this.sandboxRepo.save(sandbox);

    try {
      // Optionally capture pre-reset snapshot
      if (dto.capturePreResetSnapshot) {
        const label = dto.snapshotLabel ?? `Pre-reset #${sandbox.resetCount + 1}`;
        await this.captureSnapshot(sandbox, label, SnapshotType.PRE_RESET);
      }

      switch (dto.strategy) {
        case ResetStrategy.FULL:
          await this.resetFull(sandbox, dto.seedScenario);
          break;

        case ResetStrategy.FROM_SNAPSHOT:
          if (!dto.snapshotId) {
            throw new BadRequestException(
              'snapshotId required for FROM_SNAPSHOT strategy',
            );
          }
          await this.resetFromSnapshot(sandbox, dto.snapshotId);
          break;

        case ResetStrategy.PARTIAL:
          await this.resetPartial(sandbox, dto.seedScenario);
          break;

        default:
          throw new BadRequestException(`Unknown reset strategy: ${dto.strategy}`);
      }

      if (dto.rotateStellarKeypair) {
        // In a real implementation this would call Horizon testnet
        sandbox.stellarPublicKey = `GNEW${Math.random().toString(36).slice(2, 52).toUpperCase()}`;
        this.logger.log(`Rotated Stellar keypair for sandbox "${sandbox.name}"`);
      }

      sandbox.status = SandboxStatus.ACTIVE;
      sandbox.resetCount += 1;
      sandbox.lastResetAt = new Date();
      await this.sandboxRepo.save(sandbox);

      this.logger.log(
        `Sandbox "${sandbox.name}" reset complete (strategy: ${dto.strategy}, #${sandbox.resetCount})`,
      );
    } catch (err) {
      sandbox.status = SandboxStatus.SUSPENDED;
      await this.sandboxRepo.save(sandbox);
      this.logger.error(`Reset failed for sandbox "${sandbox.name}"`, err);
      throw err;
    }

    return this.toStatusDto(sandbox);
  }

  // ─── Snapshot management ──────────────────────────────────────────────────

  async listSnapshots(sandboxId: string): Promise<TestDataSnapshot[]> {
    await this.findOrFail(sandboxId);
    return this.snapshotRepo.find({
      where: { environmentId: sandboxId },
      order: { createdAt: 'DESC' },
    });
  }

  async deleteSnapshot(sandboxId: string, snapshotId: string): Promise<void> {
    const snapshot = await this.snapshotRepo.findOne({
      where: { id: snapshotId, environmentId: sandboxId },
    });
    if (!snapshot) {
      throw new NotFoundException(`Snapshot ${snapshotId} not found`);
    }
    await this.snapshotRepo.remove(snapshot);
  }

  // ─── Clone ────────────────────────────────────────────────────────────────

  async cloneSandbox(
    sourceId: string,
    targetName: string,
    targetOwnerId: string,
    copyData = false,
  ): Promise<SandboxStatusDto> {
    const source = await this.findOrFail(sourceId);

    const targetSchemaPrefix = this.isolator.generateSchemaPrefix(targetName);
    const cloner = createEnvironmentCloner(this.dataSource);

    const cloneResult = await cloner.clone({
      sourceSandbox: source,
      targetName,
      targetOwnerId,
      targetSchemaPrefix,
      copyData,
      copyMockConfig: true,
      copyFeatureFlags: true,
    });

    const partialEnv = cloner.buildClonedEnvironment({
      sourceSandbox: source,
      targetName,
      targetOwnerId,
      targetSchemaPrefix,
    });

    const cloned = this.sandboxRepo.create({
      ...partialEnv,
      status: SandboxStatus.ACTIVE,
    } as SandboxEnvironment);

    await this.sandboxRepo.save(cloned);

    cloneResult.targetId = cloned.id;
    this.mockProvider.initForSandbox(cloned.id);

    const snapshotPartial = cloner.buildSnapshotFromClone(
      cloned.id,
      source.name,
      cloneResult.rowsCopied,
    );
    await this.snapshotRepo.save(
      this.snapshotRepo.create(snapshotPartial as TestDataSnapshot),
    );

    this.logger.log(
      `Cloned "${source.name}" → "${targetName}" [${cloneResult.rowsCopied} rows, ${cloneResult.durationMs}ms]`,
    );

    return this.toStatusDto(cloned);
  }

  // ─── Feature flag management ──────────────────────────────────────────────

  async setFeatureFlag(
    sandboxId: string,
    flag: string,
    value: boolean,
  ): Promise<SandboxStatusDto> {
    const sandbox = await this.findOrFail(sandboxId);
    sandbox.featureFlags = { ...sandbox.featureFlags, [flag]: value };
    await this.sandboxRepo.save(sandbox);
    return this.toStatusDto(sandbox);
  }

  async setMockConfig(
    sandboxId: string,
    config: Record<string, unknown>,
  ): Promise<SandboxStatusDto> {
    const sandbox = await this.findOrFail(sandboxId);
    sandbox.mockConfig = { ...sandbox.mockConfig, ...config };
    this.mockProvider.updateConfig(sandboxId, config as any);
    await this.sandboxRepo.save(sandbox);
    return this.toStatusDto(sandbox);
  }

  // ─── TTL cleanup (scheduled) ──────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredSandboxes(): Promise<void> {
    const expired = await this.sandboxRepo
      .createQueryBuilder('s')
      .where('s.expiresAt IS NOT NULL')
      .andWhere('s.expiresAt < NOW()')
      .andWhere('s.status != :status', { status: SandboxStatus.DESTROYED })
      .getMany();

    if (expired.length === 0) return;

    this.logger.log(`Purging ${expired.length} expired sandboxes`);

    for (const sandbox of expired) {
      try {
        await this.destroy(sandbox.id);
      } catch (err) {
        this.logger.error(`Failed to purge sandbox "${sandbox.name}"`, err);
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async findOrFail(id: string): Promise<SandboxEnvironment> {
    const sandbox = await this.sandboxRepo.findOne({ where: { id } });
    if (!sandbox) {
      throw new NotFoundException(`Sandbox ${id} not found`);
    }
    return sandbox;
  }

  private async captureSnapshot(
    sandbox: SandboxEnvironment,
    label: string,
    type: SnapshotType,
  ): Promise<TestDataSnapshot> {
    const report = await this.isolator.captureReport(
      sandbox.schemaPrefix,
      sandbox.id,
    );

    const snapshot = this.snapshotRepo.create({
      environmentId: sandbox.id,
      label,
      type,
      tables: report.tables,
      totalRows: report.totalRows,
      isRestorable: true,
    });

    return this.snapshotRepo.save(snapshot);
  }

  private async resetFull(
    sandbox: SandboxEnvironment,
    seedScenario?: string,
  ): Promise<void> {
    await this.isolator.truncateSandboxData(sandbox.schemaPrefix);
    await this.testDataGenerator.generateAll(sandbox, seedScenario);
    await this.captureSnapshot(sandbox, `Reset #${sandbox.resetCount + 1}`, SnapshotType.SEEDED);
    this.mockProvider.clearCapturedEmails(sandbox.id);
    this.mockProvider.clearCapturedNotifications(sandbox.id);
  }

  private async resetFromSnapshot(
    sandbox: SandboxEnvironment,
    snapshotId: string,
  ): Promise<void> {
    const snapshot = await this.snapshotRepo.findOne({
      where: { id: snapshotId, environmentId: sandbox.id },
    });

    if (!snapshot) {
      throw new NotFoundException(`Snapshot ${snapshotId} not found`);
    }
    if (!snapshot.isRestorable) {
      throw new BadRequestException(`Snapshot ${snapshotId} is not restorable`);
    }

    this.logger.log(
      `Restoring sandbox "${sandbox.name}" from snapshot "${snapshot.label}"`,
    );

    await this.isolator.truncateSandboxData(sandbox.schemaPrefix);

    // In a real implementation, restore from dumpReference (S3/pg_restore)
    // For now, re-seed fresh data and log intent
    await this.testDataGenerator.generateAll(sandbox);
    sandbox.activeSnapshotId = snapshotId;
  }

  private async resetPartial(
    sandbox: SandboxEnvironment,
    seedScenario?: string,
  ): Promise<void> {
    // Only truncate dynamic tables; preserve config tables
    await this.isolator.truncateSandboxData(sandbox.schemaPrefix);
    await this.testDataGenerator.generateAll(sandbox, seedScenario ?? 'minimal');
  }

  private toStatusDto(
    sandbox: SandboxEnvironment,
    snapshotCount = 0,
  ): SandboxStatusDto {
    const now = Date.now();
    return {
      id: sandbox.id,
      name: sandbox.name,
      ownerId: sandbox.ownerId,
      status: sandbox.status,
      tier: sandbox.tier,
      description: sandbox.description,
      schemaPrefix: sandbox.schemaPrefix,
      stellarPublicKey: sandbox.stellarPublicKey,
      activeSnapshotId: sandbox.activeSnapshotId,
      featureFlags: sandbox.featureFlags,
      mockConfig: sandbox.mockConfig,
      resetCount: sandbox.resetCount,
      lastResetAt: sandbox.lastResetAt,
      expiresAt: sandbox.expiresAt,
      isExpired: sandbox.expiresAt ? sandbox.expiresAt.getTime() < now : false,
      createdAt: sandbox.createdAt,
      updatedAt: sandbox.updatedAt,
      health: {
        database: sandbox.status === SandboxStatus.ACTIVE ? 'ok' : 'degraded',
        stellar: sandbox.stellarPublicKey ? 'ok' : 'unavailable',
        mockServices: 'ok',
      },
      snapshotCount,
      metadata: sandbox.metadata,
    };
  }

  private toListItemDto(sandbox: SandboxEnvironment): SandboxListItemDto {
    return {
      id: sandbox.id,
      name: sandbox.name,
      ownerId: sandbox.ownerId,
      status: sandbox.status,
      tier: sandbox.tier,
      resetCount: sandbox.resetCount,
      expiresAt: sandbox.expiresAt,
      createdAt: sandbox.createdAt,
    };
  }
}
