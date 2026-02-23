import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  SignalVersion,
  SignalVersionApproval,
  UpdateApprovalStatus,
} from './entities/signal-version.entity';
import { UpdateSignalDto, CopierApprovalDto } from './dto/update-signal.dto';

// Replace with actual signal entity import
// import { Signal } from '../signal.entity';

export interface VersionHistoryResponse {
  signalId: string;
  totalVersions: number;
  versions: Array<{
    versionNumber: number;
    entryPrice: number | null;
    targetPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    notes: string | null;
    changeSummary: string | null;
    requiresApproval: boolean;
    approvedCount: number;
    rejectedCount: number;
    autoAppliedCount: number;
    createdAt: Date;
  }>;
}

export interface UpdateSignalResponse {
  signalId: string;
  newVersion: number;
  requiresApproval: boolean;
  changeSummary: string;
  copiersNotified: number;
}

export interface ApprovalResponse {
  versionId: string;
  copierId: string;
  status: UpdateApprovalStatus;
  autoAdjust: boolean;
}

@Injectable()
export class SignalVersionService {
  private readonly logger = new Logger(SignalVersionService.name);

  constructor(
    @InjectRepository(SignalVersion)
    private readonly versionRepository: Repository<SignalVersion>,

    @InjectRepository(SignalVersionApproval)
    private readonly approvalRepository: Repository<SignalVersionApproval>,

    // Inject signal repo and notification service using your project's actual classes
    @InjectRepository('Signal')
    private readonly signalRepository: Repository<any>,

    // Replace with your actual notification service
    @InjectRepository('CopierPosition')
    private readonly copierPositionRepository: Repository<any>,

    private readonly dataSource: DataSource,
  ) {}

  // -----------------------------------------------------------------------
  // Create a new version of a signal (provider only)
  // -----------------------------------------------------------------------
  async updateSignal(
    signalId: string,
    providerAddress: string,
    dto: UpdateSignalDto,
  ): Promise<UpdateSignalResponse> {
    const signal = await this.signalRepository.findOne({
      where: { id: signalId },
    });

    if (!signal) {
      throw new NotFoundException(`Signal ${signalId} not found`);
    }

    if (signal.providerAddress !== providerAddress) {
      throw new ForbiddenException('Only the signal provider can update this signal');
    }

    if (signal.status === 'closed') {
      throw new BadRequestException('Cannot update a closed signal');
    }

    if (!dto.targetPrice && !dto.stopLoss && !dto.takeProfit && !dto.entryPrice && !dto.notes) {
      throw new BadRequestException('At least one field must be provided to update');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get current version number
      const latestVersion = await this.versionRepository.findOne({
        where: { signalId },
        order: { versionNumber: 'DESC' },
      });

      const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

      // Build change summary from what actually changed
      const changeSummary = this.buildChangeSummary(signal, dto);

      // Snapshot the new values (fall back to current signal values if not in dto)
      const newVersion = this.versionRepository.create({
        signalId,
        providerAddress,
        versionNumber: nextVersionNumber,
        entryPrice: dto.entryPrice ?? signal.entryPrice ?? null,
        targetPrice: dto.targetPrice ?? signal.targetPrice ?? null,
        stopLoss: dto.stopLoss ?? signal.stopLoss ?? null,
        takeProfit: dto.takeProfit ?? signal.takeProfit ?? null,
        notes: dto.notes ?? null,
        changeSummary,
        requiresApproval: dto.requiresApproval ?? false,
      });

      await queryRunner.manager.save(SignalVersion, newVersion);

      // Apply changes to the signal itself
      if (dto.targetPrice !== undefined) signal.targetPrice = dto.targetPrice;
      if (dto.stopLoss !== undefined) signal.stopLoss = dto.stopLoss;
      if (dto.takeProfit !== undefined) signal.takeProfit = dto.takeProfit;
      if (dto.entryPrice !== undefined) signal.entryPrice = dto.entryPrice;
      signal.updatedAt = new Date();

      await queryRunner.manager.save('Signal', signal);

      await queryRunner.commitTransaction();

      // Notify copiers outside the transaction
      const copiersNotified = await this.notifyCopiers(
        signalId,
        newVersion.id,
        dto.requiresApproval ?? false,
        changeSummary,
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

  // -----------------------------------------------------------------------
  // Get full version history for a signal
  // -----------------------------------------------------------------------
  async getVersionHistory(signalId: string): Promise<VersionHistoryResponse> {
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
        stopLoss: v.stopLoss,
        takeProfit: v.takeProfit,
        notes: v.notes,
        changeSummary: v.changeSummary,
        requiresApproval: v.requiresApproval,
        approvedCount: v.approvedCount,
        rejectedCount: v.rejectedCount,
        autoAppliedCount: v.autoAppliedCount,
        createdAt: v.createdAt,
      })),
    };
  }

  // -----------------------------------------------------------------------
  // Copier approves or rejects an update
  // -----------------------------------------------------------------------
  async respondToUpdate(
    versionId: string,
    copierId: string,
    dto: CopierApprovalDto,
  ): Promise<ApprovalResponse> {
    const version = await this.versionRepository.findOne({
      where: { id: versionId },
    });

    if (!version) {
      throw new NotFoundException(`Signal version ${versionId} not found`);
    }

    if (!version.requiresApproval) {
      throw new BadRequestException('This signal update does not require approval');
    }

    // Check if copier already responded
    const existingApproval = await this.approvalRepository.findOne({
      where: { signalVersionId: versionId, copierId },
    });

    if (existingApproval) {
      throw new BadRequestException('You have already responded to this update');
    }

    // Verify copier is actually copying this signal
    const copierPosition = await this.copierPositionRepository.findOne({
      where: { signalId: version.signalId, copierId },
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

    // Update version counters
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

    // Update copier's auto-adjust preference for this signal
    if (dto.autoAdjust !== undefined) {
      await this.copierPositionRepository.update(
        { signalId: version.signalId, copierId },
        { autoAdjust: dto.autoAdjust },
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

  // -----------------------------------------------------------------------
  // Get pending approvals for a copier
  // -----------------------------------------------------------------------
  async getPendingApprovals(copierId: string): Promise
    Array<{
      versionId: string;
      signalId: string;
      changeSummary: string | null;
      targetPrice: number | null;
      stopLoss: number | null;
      takeProfit: number | null;
      createdAt: Date;
    }>
  > {
    // Find all signals this copier is copying
    const copierPositions = await this.copierPositionRepository.find({
      where: { copierId },
      select: ['signalId'],
    });

    if (!copierPositions.length) return [];

    const signalIds = copierPositions.map((p) => p.signalId);

    // Find versions that require approval that the copier has not yet responded to
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
      stopLoss: v.stopLoss,
      takeProfit: v.takeProfit,
      createdAt: v.createdAt,
    }));
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildChangeSummary(currentSignal: any, dto: UpdateSignalDto): string {
    const changes: string[] = [];

    if (dto.targetPrice !== undefined && dto.targetPrice !== currentSignal.targetPrice) {
      changes.push(`Target price: ${currentSignal.targetPrice} → ${dto.targetPrice}`);
    }
    if (dto.stopLoss !== undefined && dto.stopLoss !== currentSignal.stopLoss) {
      changes.push(`Stop loss: ${currentSignal.stopLoss} → ${dto.stopLoss}`);
    }
    if (dto.takeProfit !== undefined && dto.takeProfit !== currentSignal.takeProfit) {
      changes.push(`Take profit: ${currentSignal.takeProfit} → ${dto.takeProfit}`);
    }
    if (dto.entryPrice !== undefined && dto.entryPrice !== currentSignal.entryPrice) {
      changes.push(`Entry price: ${currentSignal.entryPrice} → ${dto.entryPrice}`);
    }
    if (dto.notes) {
      changes.push(`Notes updated`);
    }

    return changes.length ? changes.join('; ') : 'No changes detected';
  }

  private async notifyCopiers(
    signalId: string,
    versionId: string,
    requiresApproval: boolean,
    changeSummary: string,
  ): Promise<number> {
    try {
      const copierPositions = await this.copierPositionRepository.find({
        where: { signalId, status: 'active' },
        select: ['copierId', 'autoAdjust'],
      });

      if (!copierPositions.length) return 0;

      // For copiers with autoAdjust enabled and no approval required,
      // record as auto-applied immediately
      const autoApplyIds: string[] = [];

      for (const position of copierPositions) {
        if (!requiresApproval && position.autoAdjust) {
          const approval = this.approvalRepository.create({
            signalVersionId: versionId,
            copierId: position.copierId,
            status: UpdateApprovalStatus.AUTO_APPLIED,
            autoAdjust: true,
          });
          await this.approvalRepository.save(approval);
          autoApplyIds.push(position.copierId);
        }
      }

      if (autoApplyIds.length) {
        await this.versionRepository.increment(
          { id: versionId },
          'autoAppliedCount',
          autoApplyIds.length,
        );
      }

      //TODO: call actual notification service to push
      // notifications to each copier. Example stub:
      // await this.notificationService.sendBulk(
      //   copierPositions.map(p => p.copierId),
      //   {
      //     type: 'tradeUpdates',
      //     title: 'Signal Updated',
      //     body: changeSummary,
      //     data: { signalId, versionId, requiresApproval },
      //   }
      // );

      this.logger.log(
        `Notified ${copierPositions.length} copiers of signal ${signalId} update. Auto-applied for ${autoApplyIds.length}.`,
      );

      return copierPositions.length;
    } catch (error) {
      // Notification failure should not break the update itself
      this.logger.error(`Failed to notify copiers for signal ${signalId}`, error);
      return 0;
    }
  }
}