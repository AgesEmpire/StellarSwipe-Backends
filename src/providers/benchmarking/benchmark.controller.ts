import { Controller, Get, Post, Query, Body, Logger } from '@nestjs/common';
import { BenchmarkService } from './benchmark.service';
import {
  GetBenchmarkReportDto,
  BenchmarkReportDto,
  BenchmarkHistoryQueryDto,
  BenchmarkHistoryDto,
} from './dto/benchmark-report.dto';
import {
  PeerComparisonQueryDto,
  PeerComparisonReportDto,
} from './dto/peer-comparison.dto';
import {
  PercentileRankQueryDto,
  PercentileRankReportDto,
} from './dto/percentile-rank.dto';

@Controller('providers/benchmarks')
export class BenchmarkController {
  private readonly logger = new Logger(BenchmarkController.name);

  constructor(private readonly benchmarkService: BenchmarkService) {}

  /**
   * GET /providers/benchmarks/report
   * Retrieve the latest benchmark report for a provider.
   */
  @Get('report')
  async getBenchmarkReport(
    @Query() query: GetBenchmarkReportDto,
  ): Promise<BenchmarkReportDto> {
    this.logger.log(
      `Benchmark report request for provider: ${query.providerId}`,
    );
    return this.benchmarkService.getBenchmarkReport(query);
  }

  /**
   * GET /providers/benchmarks/history
   * Retrieve benchmark history for trend analysis.
   */
  @Get('history')
  async getBenchmarkHistory(
    @Query() query: BenchmarkHistoryQueryDto,
  ): Promise<BenchmarkHistoryDto> {
    this.logger.log(
      `Benchmark history request for provider: ${query.providerId}`,
    );
    return this.benchmarkService.getBenchmarkHistory(query);
  }

  /**
   * GET /providers/benchmarks/peer-comparison
   * Compare a provider against its peer group.
   */
  @Get('peer-comparison')
  async getPeerComparison(
    @Query() query: PeerComparisonQueryDto,
  ): Promise<PeerComparisonReportDto> {
    this.logger.log(
      `Peer comparison request for provider: ${query.providerId}`,
    );
    return this.benchmarkService.getPeerComparison(query);
  }

  /**
   * GET /providers/benchmarks/percentile-ranks
   * Get per-metric percentile rankings for a provider.
   */
  @Get('percentile-ranks')
  async getPercentileRanks(
    @Query() query: PercentileRankQueryDto,
  ): Promise<PercentileRankReportDto> {
    this.logger.log(
      `Percentile rank request for provider: ${query.providerId}`,
    );
    return this.benchmarkService.getPercentileRanks(query);
  }

  /**
   * POST /providers/benchmarks/calculate
   * Trigger a benchmark calculation run (admin / job use).
   */
  @Post('calculate')
  async calculateBenchmarks(
    @Body()
    body: {
      providers: Array<{ providerId: string; metrics: Record<string, number> }>;
    },
  ): Promise<{ processed: number; errors: number }> {
    this.logger.log(
      `Manual benchmark calculation triggered for ${body.providers.length} providers`,
    );
    return this.benchmarkService.calculateAndStoreBenchmarks(body.providers);
  }
}
