import {
  PipeTransform,
  Injectable,
  BadRequestException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { ArgumentMetadata } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AssetsService } from '../../assets/assets.service';

@Injectable()
export class AssetValidationPipe implements PipeTransform<any> {
  private readonly logger = new Logger(AssetValidationPipe.name);
  private readonly SUPPORTED_ASSETS_CACHE_KEY = 'supported_assets_registry';
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Optional() @Inject(CACHE_MANAGER) private cacheManager?: Cache,
    @Optional() private assetsService?: AssetsService,
  ) {}

  async transform(value: any, metadata: ArgumentMetadata) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const unsupportedAssets: string[] = [];

    // Check baseAsset if present
    if (value.baseAsset && typeof value.baseAsset === 'string') {
      const isSupported = await this.isAssetSupported(value.baseAsset);
      if (!isSupported) {
        unsupportedAssets.push(value.baseAsset);
      }
    }

    // Check counterAsset if present
    if (value.counterAsset && typeof value.counterAsset === 'string') {
      const isSupported = await this.isAssetSupported(value.counterAsset);
      if (!isSupported) {
        unsupportedAssets.push(value.counterAsset);
      }
    }

    // Check assetCode if present
    if (value.assetCode && typeof value.assetCode === 'string') {
      const isSupported = await this.isAssetSupported(value.assetCode);
      if (!isSupported) {
        unsupportedAssets.push(value.assetCode);
      }
    }

    if (unsupportedAssets.length > 0) {
      throw new BadRequestException({
        message: 'One or more asset codes are not supported',
        unsupportedAssets: Array.from(new Set(unsupportedAssets)),
      });
    }

    return value;
  }

  private async isAssetSupported(assetCode: string): Promise<boolean> {
    if (!this.assetsService || !this.cacheManager) {
      this.logger.warn('AssetValidationPipe: AssetsService or CacheManager not available, skipping validation');
      return true;
    }

    try {
      // Get cached supported assets
      let supportedAssets = await this.cacheManager.get<string[]>(this.SUPPORTED_ASSETS_CACHE_KEY);

      if (!supportedAssets) {
        // Cache miss - fetch from database
        const assets = await this.assetsService.getAllAssets();
        supportedAssets = assets.map((a) => a.code);

        // Cache for 5 minutes
        await this.cacheManager.set(this.SUPPORTED_ASSETS_CACHE_KEY, supportedAssets, this.CACHE_TTL);
      }

      return supportedAssets.includes(assetCode);
    } catch (error) {
      this.logger.error(`Error validating asset code ${assetCode}:`, error);
      // On error, fail open (allow the asset) to avoid breaking the system
      return true;
    }
  }
}
