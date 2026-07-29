import { Controller, Get, Post, Param, Logger, BadRequestException } from '@nestjs/common';
import { MarketDataIngestionService } from '../market-data-ingestion.service';
import { MarketDataIngestionJob } from '../jobs/market-data-ingestion.job';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * #533 — Market Data Ingestion Controller
 *
 * Exposes endpoints for:
 * - Triggering manual market data ingestion
 * - Retrieving latest market snapshots
 * - Monitoring ingestion pipeline health
 * - Managing supported asset pairs
 */
@Controller('api/v1/market-intelligence/ingestion')
export class MarketDataIngestionController {
  private readonly logger = new Logger(MarketDataIngestionController.name);

  constructor(
    private marketDataIngestionService: MarketDataIngestionService,
    private marketDataIngestionJob: MarketDataIngestionJob,
  ) {}

  /**
   * Manually trigger market data ingestion for all supported assets.
   */
  @Post('ingest-all')
  @ApiOperation({ summary: 'Manually trigger market data ingestion for all assets' })
  @ApiResponse({
    status: 200,
    description: 'Ingestion triggered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        totalAssets: { type: 'number' },
        startedAt: { type: 'string' },
      },
    },
  })
  async triggerIngestionAll(): Promise<{
    success: boolean;
    message: string;
    totalAssets: number;
    startedAt: string;
  }> {
    this.logger.log('Manually triggered market data ingestion for all assets');
    const assets = this.marketDataIngestionService.getSupportedAssets();
    // Fire and forget — don't wait for completion
    this.marketDataIngestionService.ingestAllMarketData().catch((error) => {
      this.logger.error('Ingestion error:', error);
    });

    return {
      success: true,
      message: 'Market data ingestion triggered',
      totalAssets: assets.length,
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Manually trigger market data ingestion for a specific asset pair.
   */
  @Post('ingest/:assetPair')
  @ApiOperation({ summary: 'Manually trigger market data ingestion for a specific asset' })
  @ApiResponse({
    status: 200,
    description: 'Ingestion triggered successfully',
  })
  async triggerIngestionForAsset(
    @Param('assetPair') assetPair: string,
  ): Promise<{
    success: boolean;
    message: string;
    assetPair: string;
    startedAt: string;
  }> {
    const validAssets = this.marketDataIngestionService.getSupportedAssets();
    if (!validAssets.includes(assetPair)) {
      throw new BadRequestException(
        `Asset pair ${assetPair} is not in supported assets list. Supported: ${validAssets.join(', ')}`,
      );
    }

    this.logger.log(`Manually triggered market data ingestion for ${assetPair}`);
    this.marketDataIngestionService.ingestMarketData(assetPair).catch((error) => {
      this.logger.error(`Ingestion error for ${assetPair}:`, error);
    });

    return {
      success: true,
      message: `Market data ingestion triggered for ${assetPair}`,
      assetPair,
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the latest market snapshot for an asset pair.
   */
  @Get('snapshot/:assetPair')
  @ApiOperation({ summary: 'Get the latest market snapshot for an asset pair' })
  @ApiResponse({
    status: 200,
    description: 'Latest market snapshot',
  })
  async getLatestSnapshot(@Param('assetPair') assetPair: string): Promise<{
    success: boolean;
    data: any;
    timestamp: string;
  }> {
    const snapshot = await this.marketDataIngestionService.getLatestSnapshot(
      assetPair,
    );

    if (!snapshot) {
      return {
        success: false,
        data: null,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      success: true,
      data: snapshot,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get all supported asset pairs for ingestion.
   */
  @Get('supported-assets')
  @ApiOperation({ summary: 'Get list of supported asset pairs for ingestion' })
  @ApiResponse({
    status: 200,
    description: 'List of supported assets',
    schema: {
      type: 'object',
      properties: {
        assets: {
          type: 'array',
          items: { type: 'string' },
        },
        count: { type: 'number' },
      },
    },
  })
  getSupportedAssets(): { assets: string[]; count: number } {
    const assets = this.marketDataIngestionService.getSupportedAssets();
    return {
      assets,
      count: assets.length,
    };
  }

  /**
   * Get market data ingestion pipeline metrics and health status.
   */
  @Get('health')
  @ApiOperation({
    summary: 'Get market data ingestion pipeline health and metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Pipeline health status',
  })
  getHealth(): {
    success: boolean;
    health: {
      ingestionMetrics: any;
      jobHealth: any;
      timestamp: string;
    };
  } {
    const ingestionMetrics = this.marketDataIngestionService.getIngestionMetrics();
    const jobHealth = this.marketDataIngestionJob.getJobHealth();

    return {
      success: true,
      health: {
        ingestionMetrics,
        jobHealth,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Add a new asset pair to ingestion (runtime configuration).
   */
  @Post('add-asset/:assetPair')
  @ApiOperation({ summary: 'Add a new asset pair to ingestion' })
  @ApiResponse({
    status: 200,
    description: 'Asset pair added successfully',
  })
  addAsset(@Param('assetPair') assetPair: string): {
    success: boolean;
    message: string;
    assetPair: string;
  } {
    // Validate format
    if (!assetPair.includes('/')) {
      throw new BadRequestException(
        'Asset pair must be in BASE/QUOTE format (e.g., XLM/USD)',
      );
    }

    this.marketDataIngestionService.addSupportedAsset(assetPair);
    this.logger.log(`Added asset pair ${assetPair} to ingestion`);

    return {
      success: true,
      message: `Asset pair ${assetPair} added to ingestion`,
      assetPair,
    };
  }
}
