import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetFreeze, FreezeStatus } from './entities/asset-freeze.entity';
import { FreezeAssetDto, UnfreezeAssetDto } from './dto/freeze-asset.dto';
import { AssetFreezeCheckDto, AssetFreezeStatusDto } from './dto/asset-freeze-status.dto';

@Injectable()
export class AssetFreezeService {
  private readonly logger = new Logger(AssetFreezeService.name);

  constructor(
    @InjectRepository(AssetFreeze)
    private readonly freezeRepository: Repository<AssetFreeze>,
  ) {}

  /**
   * Freeze an asset, preventing it from being transferred or traded.
   * Throws if the asset is already frozen.
   */
  async freezeAsset(dto: FreezeAssetDto, adminId: string): Promise<AssetFreezeStatusDto> {
    const existing = await this.getActiveFreezeRecord(dto.assetId);

    if (existing) {
      throw new BadRequestException(
        `Asset ${dto.assetId} is already frozen. Unfreeze it before applying a new freeze.`,
      );
    }

    const freeze = this.freezeRepository.create({
      assetId: dto.assetId,
      status: FreezeStatus.FROZEN,
      reason: dto.reason,
      description: dto.description ?? null,
      initiatedBy: adminId,
      frozenAt: new Date(),
      unfrozenAt: null,
    });

    const saved = await this.freezeRepository.save(freeze);
    this.logger.log(`Asset ${dto.assetId} frozen by admin ${adminId} — reason: ${dto.reason}`);

    return this.toStatusDto(saved);
  }

  /**
   * Unfreeze a previously frozen asset, restoring transfer and trading capability.
   * Throws if the asset is not currently frozen.
   */
  async unfreezeAsset(dto: UnfreezeAssetDto, adminId: string): Promise<AssetFreezeStatusDto> {
    const freeze = await this.getActiveFreezeRecord(dto.assetId);

    if (!freeze) {
      throw new NotFoundException(
        `Asset ${dto.assetId} is not currently frozen.`,
      );
    }

    freeze.status = FreezeStatus.UNFROZEN;
    freeze.unfrozenAt = new Date();
    freeze.initiatedBy = adminId;

    if (dto.description) {
      freeze.description = dto.description;
    }

    const saved = await this.freezeRepository.save(freeze);
    this.logger.log(`Asset ${dto.assetId} unfrozen by admin ${adminId}`);

    return this.toStatusDto(saved);
  }

  /**
   * Check whether a specific asset is currently frozen.
   * Returns the active freeze record if one exists.
   */
  async checkFreezeStatus(assetId: string): Promise<AssetFreezeCheckDto> {
    const activeFreeze = await this.getActiveFreezeRecord(assetId);

    return {
      assetId,
      isFrozen: activeFreeze !== null,
      activeFreeze: activeFreeze ? this.toStatusDto(activeFreeze) : null,
    };
  }

  /**
   * Returns true if the asset is currently frozen.
   * Use this in trade/transfer pipelines to gate operations.
   */
  async isFrozen(assetId: string): Promise<boolean> {
    const record = await this.getActiveFreezeRecord(assetId);
    return record !== null;
  }

  /**
   * Retrieve the full audit history of freeze/unfreeze actions for an asset.
   */
  async getFreezeHistory(assetId: string): Promise<AssetFreezeStatusDto[]> {
    const records = await this.freezeRepository.find({
      where: { assetId },
      order: { createdAt: 'DESC' },
    });

    return records.map((r) => this.toStatusDto(r));
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getActiveFreezeRecord(assetId: string): Promise<AssetFreeze | null> {
    return this.freezeRepository.findOne({
      where: { assetId, status: FreezeStatus.FROZEN },
    });
  }

  private toStatusDto(freeze: AssetFreeze): AssetFreezeStatusDto {
    return {
      id: freeze.id,
      assetId: freeze.assetId,
      status: freeze.status,
      reason: freeze.reason,
      description: freeze.description,
      initiatedBy: freeze.initiatedBy,
      frozenAt: freeze.frozenAt,
      unfrozenAt: freeze.unfrozenAt,
      createdAt: freeze.createdAt,
      updatedAt: freeze.updatedAt,
    };
  }
}
