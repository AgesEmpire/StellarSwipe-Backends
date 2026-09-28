import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Between, MoreThanOrEqual } from 'typeorm';
import { Position } from '../../portfolio/entities/position.entity';
import { ArchivedPosition } from '../../portfolio/entities/archived-position.entity';
import { CopiedPosition, PositionStatus } from '../../signals/entities/copied-position.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PositionArchiveService {
  private readonly logger = new Logger(PositionArchiveService.name);

  constructor(
    @InjectRepository(Position)
    private readonly positionRepository: Repository<Position>,
    @InjectRepository(ArchivedPosition)
    private readonly archivedPositionRepository: Repository<ArchivedPosition>,
    @InjectRepository(CopiedPosition)
    private readonly copiedPositionRepository: Repository<CopiedPosition>,
    private readonly configService: ConfigService,
  ) {}

  async archiveClosedPositions(retentionDays?: number): Promise<{ archived: number; eligible: number }> {
    const days = retentionDays ?? this.configService.get<number>('POSITION_ARCHIVE_RETENTION_DAYS', 90);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.logger.log(`Starting position archival for positions closed before ${cutoffDate.toISOString()}`);

    const [eligiblePositions, total] = await this.positionRepository.findAndCount({
      where: {
        isActive: false,
        updatedAt: LessThan(cutoffDate),
      },
    });

    this.logger.log(`Found ${eligiblePositions.length} eligible positions out of ${total} total positions`);

    let archived = 0;
    for (const position of eligiblePositions) {
      const existingArchive = await this.archivedPositionRepository.findOne({
        where: { originalPositionId: position.id },
      });

      if (existingArchive) {
        this.logger.warn(`Position ${position.id} already archived, skipping`);
        continue;
      }

      const archivedPosition = this.archivedPositionRepository.create({
        originalPositionId: position.id,
        userId: position.userId,
        tradeId: position.tradeId,
        baseAsset: position.baseAsset,
        counterAsset: position.counterAsset,
        side: position.side,
        amount: position.amount,
        entryPrice: position.entryPrice,
        exitPrice: undefined,
        realizedPnL: undefined,
        closedAt: position.updatedAt,
        archivedAt: new Date(),
      });

      await this.archivedPositionRepository.save(archivedPosition);
      await this.positionRepository.remove(position);
      archived++;
    }

    this.logger.log(`Archived ${archived} positions to cold storage`);
    return { archived, eligible: eligiblePositions.length };
  }

  async archiveClosedCopiedPositions(retentionDays?: number): Promise<{ archived: number; eligible: number }> {
    const days = retentionDays ?? this.configService.get<number>('POSITION_ARCHIVE_RETENTION_DAYS', 90);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.logger.log(`Starting copied position archival for positions closed before ${cutoffDate.toISOString()}`);

    const [eligiblePositions, total] = await this.copiedPositionRepository.findAndCount({
      where: {
        status: PositionStatus.CLOSED,
        closedAt: LessThan(cutoffDate),
      },
    });

    this.logger.log(`Found ${eligiblePositions.length} eligible copied positions out of ${total} total`);

    let archived = 0;
    for (const position of eligiblePositions) {
      const archivedPosition = this.archivedPositionRepository.create({
        originalPositionId: position.id,
        userId: position.userId,
        tradeId: undefined,
        baseAsset: undefined,
        counterAsset: undefined,
        side: undefined,
        amount: undefined,
        entryPrice: undefined,
        exitPrice: position.pnlPercentage ? position.pnlPercentage : undefined,
        realizedPnL: position.pnlAbsolute,
        closedAt: position.closedAt,
        archivedAt: new Date(),
      });

      await this.archivedPositionRepository.save(archivedPosition);
      await this.copiedPositionRepository.remove(position);
      archived++;
    }

    this.logger.log(`Archived ${archived} copied positions to cold storage`);
    return { archived, eligible: eligiblePositions.length };
  }

  async getArchivedPositions(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<ArchivedPosition[]> {
    const where: any = { userId };

    if (startDate && endDate) {
      where.closedAt = Between(startDate, endDate) as any;
    } else if (startDate) {
      where.closedAt = MoreThanOrEqual(startDate) as any;
    } else if (endDate) {
      where.closedAt = LessThanOrEqual(endDate) as any;
    }

    return this.archivedPositionRepository.find({
      where,
      order: { closedAt: 'DESC' },
    });
  }

  async restoreArchivedPosition(archivedPositionId: string): Promise<Position | null> {
    const archived = await this.archivedPositionRepository.findOne({
      where: { id: archivedPositionId },
    });

    if (!archived) {
      return null;
    }

    if (!archived.tradeId || !archived.baseAsset || !archived.entryPrice) {
      this.logger.warn(`Archived position ${archivedPositionId} lacks required fields for restoration`);
      return null;
    }

    const position = this.positionRepository.create({
      userId: archived.userId,
      tradeId: archived.tradeId,
      baseAsset: archived.baseAsset,
      counterAsset: archived.counterAsset,
      side: archived.side as any,
      amount: archived.amount,
      entryPrice: archived.entryPrice,
      currentPrice: archived.exitPrice || '0',
      unrealizedPnL: archived.realizedPnL || '0',
      isActive: false,
    });

    await this.positionRepository.save(position);
    await this.archivedPositionRepository.remove(archived);

    return position;
  }
}