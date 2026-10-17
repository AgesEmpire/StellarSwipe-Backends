import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Asset, AssetType } from './entities/asset.entity';
import { AssetPair } from './entities/asset-pair.entity';
import { CreateAssetDto, AssetPriceDto, AssetDto, AssetPairDto } from './dto/asset-price.dto';
import axios from 'axios';
import { TrustlineEstablishmentService } from './trustline-establishment.service';

/**
 * Structured audit event emitted on supported-asset registry mutations.
 * Sensitive values (e.g. trustline secrets) are never included.
 */
export interface AssetRegistryAuditEvent {
  action: 'add' | 'change' | 'disable' | 'remove';
  assetCode: string;
  assetIssuer: string | null;
  actor: string;
  changes?: Record<string, { before: unknown; after: unknown }>;
  timestamp: string;
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly HORIZON_BASE_URL = 'https://horizon.stellar.org';
  private readonly PRICE_CACHE_TTL = 60 * 1000; // 60 seconds
  private readonly PRICE_CACHE_KEY_PREFIX = 'asset_price:';

  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
    @InjectRepository(AssetPair)
    private assetPairRepository: Repository<AssetPair>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private trustlineService: TrustlineEstablishmentService,
  ) {
    this.initializeCoreAssets();
  }

  /**
   * Emit a structured audit event for a supported-asset registry mutation.
   * Only non-sensitive metadata is included.
   */
  private emitRegistryAuditEvent(event: AssetRegistryAuditEvent): void {
    this.logger.log(
      `asset_registry_audit ${JSON.stringify({
        action: event.action,
        assetCode: event.assetCode,
        assetIssuer: event.assetIssuer,
        actor: event.actor,
        changes: event.changes,
        timestamp: event.timestamp,
      })}`,
    );
  }

  /**
   * Compute before/after diff for auditable asset fields, excluding sensitive values.
   */
  private buildAssetChanges(
    before: Partial<Asset>,
    after: Partial<Asset>,
  ): Record<string, { before: unknown; after: unknown }> {
    const auditableFields: (keyof Asset)[] = [
      'code',
      'issuer',
      'type',
      'name',
      'description',
      'logoUrl',
      'isVerified',
      'isPopular',
      'isActive',
    ];
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of auditableFields) {
      const beforeValue = before[field];
      const afterValue = after[field];
      if (afterValue !== undefined && beforeValue !== afterValue) {
        changes[field as string] = { before: beforeValue, after: afterValue };
      }
    }
    return changes;
  }

  /**
   * Initialize core assets on service startup
   */
  private async initializeCoreAssets() {
    try {
      const coreAssets = [
        {
          code: 'XLM',
          issuer: null,
          type: AssetType.NATIVE,
          name: 'Stellar Lumens',
          description: 'Native currency of Stellar network',
          logoUrl: 'https://assets.coingecko.com/coins/images/100/small/Stellar_symbol-white-circles.png',
          isVerified: true,
          isPopular: true,
        },
        {
          code: 'USDC',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4GZ5DA47GDEVS2HW6LBX4KIFNDUYAPG',
          type: AssetType.ISSUED,
          name: 'Circle USD Coin',
          description: 'Fully collateralized US dollar stablecoin',
          logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
          isVerified: true,
          isPopular: true,
        },
        {
          code: 'AQUA',
          issuer: 'GBNZILSTVQSRDG5OKDJVVVX3VS3ZGGF3BYRTOJSQHXLWMCBOGB2CBJBJ',
          type: AssetType.ISSUED,
          name: 'Aqua Token',
          description: 'AquaNetwork governance token',
          logoUrl: 'https://assets.coingecko.com/coins/images/14468/small/aqua.png',
          isVerified: true,
          isPopular: true,
        },
        {
          code: 'yXLM',
          issuer: 'GARDNV3Q7YKM4CMWQ2P3QZZQ2CJX7Y6MPJZR5YFHP2XGFPZ6LNKFVSX3',
          type: AssetType.ISSUED,
          name: 'Ultra Stellar',
          description: 'Ultra Stellar token',
          logoUrl: 'https://assets.coingecko.com/coins/images/22122/small/yxlm_logo.png',
          isVerified: true,
          isPopular: false,
        },
      ];

      for (const assetData of coreAssets) {
        let exists;
        if (assetData.issuer === null) {
          exists = await this.assetRepository.findOne({
            where: { code: assetData.code, issuer: IsNull() },
          });
        } else {
          exists = await this.assetRepository.findOne({
            where: { code: assetData.code, issuer: assetData.issuer },
          });
        }

        if (!exists) {
          await this.assetRepository.save(assetData);
          this.logger.log(`Created core asset: ${assetData.code}`);
        }
      }

      // Initialize core trading pairs
      await this.initializeCorePairs();
    } catch (error) {
      this.logger.error('Error initializing core assets:', error);
    }
  }

  /**
   * Initialize core trading pairs
   */
  private async initializeCorePairs() {
    try {
      const xlm = await this.assetRepository.findOne({ where: { code: 'XLM' } });
      const usdc = await this.assetRepository.findOne({ where: { code: 'USDC' } });
      const aqua = await this.assetRepository.findOne({ where: { code: 'AQUA' } });

      if (xlm && usdc) {
        const pair1 = await this.assetPairRepository.findOne({
          where: { baseAssetId: xlm.id, counterAssetId: usdc.id },
        });
        if (!pair1) {
          await this.assetPairRepository.save({
            baseAsset: xlm,
            counterAsset: usdc,
            isTradable: true,
          });
          this.logger.log('Created pair: XLM/USDC');
        }
      }

      if (usdc && xlm) {
        const pair2 = await this.assetPairRepository.findOne({
          where: { baseAssetId: usdc.id, counterAssetId: xlm.id },
        });
        if (!pair2) {
          await this.assetPairRepository.save({
            baseAsset: usdc,
            counterAsset: xlm,
            isTradable: true,
          });
          this.logger.log('Created pair: USDC/XLM');
        }
      }

      if (aqua && xlm) {
        const pair3 = await this.assetPairRepository.findOne({
          where: { baseAssetId: aqua.id, counterAssetId: xlm.id },
        });
        if (!pair3) {
          await this.assetPairRepository.save({
            baseAsset: aqua,
            counterAsset: xlm,
            isTradable: true,
          });
          this.logger.log('Created pair: AQUA/XLM');
        }
      }
    } catch (error) {
      this.logger.error('Error initializing core pairs:', error);
    }
  }

  /**
   * Get all supported assets
   */
  async getAllAssets(): Promise<AssetDto[]> {
    const assets = await this.assetRepository.find({
      order: { isPopular: 'DESC', popularity: 'DESC', createdAt: 'ASC' },
    });

    return assets.map(this.mapAssetToDto);
  }

  /**
   * Get all tradable asset pairs
   */
  async getAssetPairs(): Promise<AssetPairDto[]> {
    const pairs = await this.assetPairRepository.find({
      where: { isTradable: true },
      relations: ['baseAsset', 'counterAsset'],
      order: { createdAt: 'ASC' },
    });

    return pairs.map((pair) => this.mapPairToDto(pair));
  }

  /**
   * Get price for a specific asset pair
   */
  async getAssetPrice(pair: string): Promise<AssetPriceDto | null> {
    const cacheKey = this.PRICE_CACHE_KEY_PREFIX + pair;

    // Try to get from cache first
    const cached = await this.cacheManager.get<AssetPriceDto>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const price = await this.fetchPriceFromHorizon(pair);
      if (price) {
        // Cache the price for 60 seconds
        await this.cacheManager.set(cacheKey, price, this.PRICE_CACHE_TTL);
      }
      return price;
    } catch (error) {
      this.logger.error(`Error fetching price for pair ${pair}:`, error);
      return null;
    }
  }

  /**
   * Validate if asset pair is tradable
   */
  async validateAssetPair(baseAssetCode: string, counterAssetCode: string): Promise<boolean> {
    const baseAsset = await this.assetRepository.findOne({
      where: { code: baseAssetCode },
    });

    const counterAsset = await this.assetRepository.findOne({
      where: { code: counterAssetCode },
    });

    if (!baseAsset || !counterAsset) {
      return false;
    }

    const pair = await this.assetPairRepository.findOne({
      where: {
        baseAssetId: baseAsset.id,
        counterAssetId: counterAsset.id,
        isTradable: true,
      },
    });

    return !!pair;
  }

  /**
   * Create a new asset
   */
  async createAsset(createAssetDto: CreateAssetDto, actor: string = 'system'): Promise<Asset> {
    // Validate asset code length
    if (createAssetDto.code.length > 12) {
      throw new BadRequestException('Asset code must be 12 characters or less');
    }

    // Check if asset already exists
    let existing;
    if (!createAssetDto.issuer) {
      existing = await this.assetRepository.findOne({
        where: { code: createAssetDto.code, issuer: IsNull() },
      });
    } else {
      existing = await this.assetRepository.findOne({
        where: { code: createAssetDto.code, issuer: createAssetDto.issuer },
      });
    }

    if (existing) {
      throw new BadRequestException('Asset already exists');
    }

    const asset = this.assetRepository.create(createAssetDto);
    const saved = await this.assetRepository.save(asset);

    this.emitRegistryAuditEvent({
      action: 'add',
      assetCode: saved.code,
      assetIssuer: saved.issuer ?? null,
      actor,
      changes: this.buildAssetChanges({}, saved),
      timestamp: new Date().toISOString(),
    });

    return saved;
  }

  /**
   * Update an existing asset
   */
  async updateAsset(
    id: string,
    updateAssetDto: Partial<CreateAssetDto>,
    actor: string = 'system',
  ): Promise<Asset> {
    const asset = await this.assetRepository.findOne({ where: { id } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const before: Partial<Asset> = { ...asset };
    Object.assign(asset, updateAssetDto);
    const saved = await this.assetRepository.save(asset);

    this.emitRegistryAuditEvent({
      action: 'change',
      assetCode: saved.code,
      assetIssuer: saved.issuer ?? null,
      actor,
      changes: this.buildAssetChanges(before, saved),
      timestamp: new Date().toISOString(),
    });

    return saved;
  }

  /**
   * Disable an asset in the registry
   */
  async disableAsset(id: string, actor: string = 'system'): Promise<Asset> {
    const asset = await this.assetRepository.findOne({ where: { id } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const before: Partial<Asset> = { ...asset };
    asset.isActive = false;
    const saved = await this.assetRepository.save(asset);

    this.emitRegistryAuditEvent({
      action: 'disable',
      assetCode: saved.code,
      assetIssuer: saved.issuer ?? null,
      actor,
      changes: this.buildAssetChanges(before, saved),
      timestamp: new Date().toISOString(),
    });

    return saved;
  }

  /**
   * Remove an asset from the registry
   */
  async removeAsset(id: string, actor: string = 'system'): Promise<void> {
    const asset = await this.assetRepository.findOne({ where: { id } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    await this.assetRepository.remove(asset);

    this.emitRegistryAuditEvent({
      action: 'remove',
      assetCode: asset.code,
      assetIssuer: asset.issuer ?? null,
      actor,
      changes: this.buildAssetChanges(asset, {}),
      timestamp: new Date().toISOString(),
    });
  }

  private mapAssetToDto(asset: Asset): AssetDto {
    return {
      code: asset.code,
      issuer: asset.issuer,
      type: asset.type,
      name: asset.name,
      description: asset.description,
      logoUrl: asset.logoUrl,
      isVerified: asset.isVerified,
      isPopular: asset.isPopular,
    } as AssetDto;
  }

  private mapPairToDto(pair: AssetPair): AssetPairDto {
    return {
      baseAsset: this.mapAssetToDto(pair.baseAsset),
      counterAsset: this.mapAssetToDto(pair.counterAsset),
      isTradable: pair.isTradable,
    } as AssetPairDto;
  }

  private async fetchPriceFromHorizon(pair: string): Promise<AssetPriceDto | null> {
    try {
      const response = await axios.get(`${this.HORIZON_BASE_URL}/order_book`, {
        params: { selling_asset_code: pair.split('/')[0], buying_asset_code: pair.split('/')[1] },
      });
      return response.data as AssetPriceDto;
    } catch (error) {
      this.logger.error(`Error fetching price from Horizon for ${pair}:`, error);
      return null;
    }
  }
}
