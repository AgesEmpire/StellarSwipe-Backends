import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThan } from 'typeorm';
import {
  SignalVersion,
  SignalVersionApproval,
  UpdateApprovalStatus,
} from './entities/signal-version.entity';
import { UpdateSignalDto, CopierApprovalDto } from './dto/update-signal.dto';
import { Signal, SignalStatus } from '../entities/signal.entity';
import { CopiedPosition } from '../entities/copied-position.entity';

const MAX_UPDATES_PER_SIGNAL = 5;
const UPDATE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class SignalVersionService {
  private readonly logger = new Logger(SignalVersionService.name);

  constructor(
    @InjectRepository(SignalVersion)
    private readonly versionRepository: Repository<SignalVersion>,
    @InjectRepository(SignalVersionApproval)
    private readonly approvalRepository: Repository<SignalVersionApproval>,
    @InjectRepository(Signal)
    private readonly signalRepository: Repository<Signal>,
    @InjectRepository(CopiedPosition)
    private readonly copiedPositionRepository: Repository<CopiedPosition>,
    private readonly dataSource: DataSource,
  ) {}

  async updateSignal(
    signalId: string,
    providerId: string,
    dto: UpdateSignalDto,
  ): Promise<{
    signalId: string;
    newVersion: number;
    requiresApproval: boolean;
    changeSummary: string;
    copiersNotified: number;
  }> {
    const signal = await this.signalRepository.findOne({
      where: { id: signalId },
    });

    if (!signal) {
      throw new NotFoundException(`Signal ${signalId} not found`);
    }

    if (signal.providerId !== providerId) {
      throw new ForbiddenException(
        'Only the signal provider can update this signal',
      );
    }

    if (signal.status !== SignalStatus.ACTIVE) {
      throw new BadRequestException('Cannot update inactive signal');
    }

    if (new Date() > signal.expiresAt) {
      throw new BadRequestException('Cannot update expired signal');
    }

    if (
      !dto.targetPrice &&
      !dto.stopLossPrice &&
      !dto.entryPrice &&
      !dto.rationale
    ) {
      throw new BadRequestException(
        'At least one field must be provided to update',
      );
    }

    const latestVersion = await this.versionRepository.findOne({
      where: { signalId },
      order: { versionNumber: 'DESC' },
    });

    const currentVersionNumber = latestVersion?.versionNumber || 0;

    if (currentVersionNumber >= MAX_UPDATES_PER_SIGNAL) {
      throw new BadRequestException(
        `Maximum ${MAX_UPDATES_PER_SIGNAL} updates per signal reached`,
      );
    }

    if (latestVersion) {
      const timeSinceLastUpdate =
        Date.now() - latestVersion.createdAt.getTime();
      if (timeSinceLastUpdate < UPDATE_COOLDOWN_MS) {
        const remainingMinutes = Math.ceil(
          (UPDATE_COOLDOWN_MS - timeSinceLastUpdate) / 60000,
        );
        throw new BadRequestException(
          `Must wait ${remainingMinutes} minutes before next update`,
        );
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const nextVersionNumber = currentVersionNumber + 1;
      const changeSummary = this.buildChangeSummary(signal, dto);

      const newVersion = this.versionRepository.create({
        signalId,
        providerId,
        versionNumber: nextVersionNumber,
        entryPrice: dto.entryPrice ?? signal.entryPrice,
        targetPrice: dto.targetPrice ?? signal.targetPrice,
        stopLossPrice: dto.stopLossPrice ?? signal.stopLossPrice,
        rationale: dto.rationale ?? signal.rationale,
        changeSummary,
        requiresApproval: dto.requiresApproval ?? false,
      });

      await queryRunner.manager.save(SignalVersion, newVersion);

      if (dto.targetPrice) signal.targetPrice = dto.targetPrice;
      if (dto.stopLossPrice) signal.stopLossPrice = dto.stopLossPrice;
      if (dto.entryPrice) signal.entryPrice = dto.entryPrice;
      if (dto.rationale) signal.rationale = dto.rationale;
      signal.updatedAt = new Date();

      await queryRunner.manager.save(Signal, signal);
      await queryRunner.commitTransaction();

      const copiersNotified = await this.notifyCopiers(
        signalId,
        newVersion.id,
        dto.requiresApproval ?? false,
      );

      return {
        signalId,
        newVersion: nextVersionNumber,
        requiresApproval: dto.requiresApproval ?? false,
        changeSummary,
        copiersNotified,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getVersionHistory(signalId: string): Promise<{
    signalId: string;
    totalVersions: number;
    versions: Array<{
      versionNumber: number;
      entryPrice: string | null;
      targetPrice: string | null;
      stopLossPrice: string | null;
      rationale: string | null;
      changeSummary: string | null;
      requiresApproval: boolean;
      approvedCount: number;
      rejectedCount: number;
      autoAppliedCount: number;
      createdAt: Date;
    }>;
  }> {
    const signal = await this.signalRepository.findOne({
      where: { id: signalId },
    });

    if (!signal) {
      throw new NotFoundException(`Signal ${signalId} not found`);
    }

    const versions = await this.versionRepository.find({
      where: { signalId },
      order: { versionNumber: 'DESC' },
    });

    return {
      signalId,
      totalVersions: versions.length,
      versions: versions.map((v) => ({
        versionNumber: v.versionNumber,
        entryPrice: v.entryPrice,
        targetPrice: v.targetPrice,
        stopLossPrice: v.stopLossPrice,
        rationale: v.rationale,
        changeSummary: v.changeSummary,
        requiresApproval: v.requiresApproval,
        approvedCount: v.approvedCount,
        rejectedCount: v.rejectedCount,
        autoAppliedCount: v.autoAppliedCount,
        createdAt: v.createdAt,
      })),
    };
  }

  async respondToUpdate(
    versionId: string,
    copierId: string,
    dto: CopierApprovalDto,
  ): Promise<{
    versionId: string;
    copierId: string;
    status: UpdateApprovalStatus;
    autoAdjust: boolean;
  }> {
    const version = await this.versionRepository.findOne({
      where: { id: versionId },
    });

    if (!version) {
      throw new NotFoundException(`Signal version ${versionId} not found`);
    }

    if (!version.requiresApproval) {
      throw new BadRequestException(
        'This signal update does not require approval',
      );
    }

    const existingApproval = await this.approvalRepository.findOne({
      where: { signalVersionId: versionId, copierId },
    });

    if (existingApproval) {
      throw new BadRequestException(
        'You have already responded to this update',
      );
    }

    const copierPosition = await this.copiedPositionRepository.findOne({
      where: { signalId: version.signalId, userId: copierId },
    });

    if (!copierPosition) {
      throw new ForbiddenException('You are not copying this signal');
    }

    const status = dto.approved
      ? UpdateApprovalStatus.APPROVED
      : UpdateApprovalStatus.REJECTED;

    const approval = this.approvalRepository.create({
      signalVersionId: versionId,
      copierId,
      status,
      autoAdjust: dto.autoAdjust ?? false,
    });

    await this.approvalRepository.save(approval);

    if (dto.approved) {
      await this.versionRepository.increment(
        { id: versionId },
        'approvedCount',
        1,
      );
    } else {
      await this.versionRepository.increment(
        { id: versionId },
        'rejectedCount',
        1,
      );
    }

    this.logger.log(
      `Copier ${copierId} ${status} version ${versionId} (autoAdjust: ${dto.autoAdjust ?? false})`,
    );

    return {
      versionId,
      copierId,
      status,
      autoAdjust: dto.autoAdjust ?? false,
    };
  }

  async getPendingApprovals(copierId: string): Promise<
    Array<{
      versionId: string;
      signalId: string;
      changeSummary: string | null;
      targetPrice: string | null;
      stopLossPrice: string | null;
      createdAt: Date;
    }>
  > {
    const copierPositions = await this.copiedPositionRepository.find({
      where: { userId: copierId },
      select: ['signalId'],
    });

    if (!copierPositions.length) return [];

    const signalIds = copierPositions.map((p) => p.signalId);

    const pendingVersions = await this.versionRepository
      .createQueryBuilder('version')
      .where('version.signal_id IN (:...signalIds)', { signalIds })
      .andWhere('version.requires_approval = true')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM signal_version_approvals a
          WHERE a.signal_version_id = version.id
          AND a.copier_id = :copierId
        )`,
        { copierId },
      )
      .orderBy('version.created_at', 'DESC')
      .getMany();

    return pendingVersions.map((v) => ({
      versionId: v.id,
      signalId: v.signalId,
      changeSummary: v.changeSummary,
      targetPrice: v.targetPrice,
      stopLossPrice: v.stopLossPrice,
      createdAt: v.createdAt,
    }));
  }

  async getCopiedVersion(
    signalId: string,
    copierId: string,
  ): Promise<number | null> {
    const position = await this.copiedPositionRepository.findOne({
      where: { signalId, userId: copierId },
    });

    if (!position) return null;

    const versionAtCopyTime = await this.versionRepository.findOne({
      where: {
        signalId,
        createdAt: MoreThan(position.createdAt),
      },
      order: { versionNumber: 'ASC' },
    });

    return versionAtCopyTime
      ? versionAtCopyTime.versionNumber - 1
      : await this.getLatestVersionNumber(signalId);
  }

  private async getLatestVersionNumber(signalId: string): Promise<number> {
    const latest = await this.versionRepository.findOne({
      where: { signalId },
      order: { versionNumber: 'DESC' },
    });
    return latest?.versionNumber || 0;
  }

  private buildChangeSummary(
    currentSignal: Signal,
    dto: UpdateSignalDto,
  ): string {
    const changes: string[] = [];

    if (dto.targetPrice && dto.targetPrice !== currentSignal.targetPrice) {
      changes.push(`Target: ${currentSignal.targetPrice} → ${dto.targetPrice}`);
    }
    if (
      dto.stopLossPrice &&
      dto.stopLossPrice !== currentSignal.stopLossPrice
    ) {
      changes.push(
        `Stop Loss: ${currentSignal.stopLossPrice} → ${dto.stopLossPrice}`,
      );
    }
    if (dto.entryPrice && dto.entryPrice !== currentSignal.entryPrice) {
      changes.push(`Entry: ${currentSignal.entryPrice} → ${dto.entryPrice}`);
    }
    if (dto.rationale) {
      changes.push('Rationale updated');
    }

    return changes.length ? changes.join('; ') : 'No changes detected';
  }

  private async notifyCopiers(
    signalId: string,
    versionId: string,
    requiresApproval: boolean,
  ): Promise<number> {
    try {
      const copierPositions = await this.copiedPositionRepository.find({
        where: { signalId },
        select: ['userId', 'copierId'],
      });

      if (!copierPositions.length) return 0;

      const autoApplyIds: string[] = [];

      for (const position of copierPositions) {
        const userId = position.userId || position.copierId;
        if (!userId) continue;

        if (!requiresApproval) {
          const approval = this.approvalRepository.create({
            signalVersionId: versionId,
            copierId: userId,
            status: UpdateApprovalStatus.AUTO_APPLIED,
            autoAdjust: true,
          });
          await this.approvalRepository.save(approval);
          autoApplyIds.push(userId);
        }
      }

      if (autoApplyIds.length) {
        await this.versionRepository.increment(
          { id: versionId },
          'autoAppliedCount',
          autoApplyIds.length,
        );
      }

      this.logger.log(
        `Notified ${copierPositions.length} copiers of signal ${signalId} update. Auto-applied for ${autoApplyIds.length}.`,
      );

      return copierPositions.length;
    } catch (error) {
      this.logger.error(
        `Failed to notify copiers for signal ${signalId}`,
        error,
      );
      return 0;
    }
  }
}
