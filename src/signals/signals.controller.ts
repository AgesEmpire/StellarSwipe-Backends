import {
  Controller,
  Get,
  Post,
 feat/signal-performance
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SignalPerformanceService } from './services/signal-performance.service';
import { ProviderStatsService } from './services/provider-stats.service';
import { SIGNAL_TRACKING_QUEUE } from './jobs/track-signal-outcomes.job';
import {
  CreateSignalDto,
  UpdateSignalDto,
  SignalQueryDto,
  PerformanceQueryDto,
  ProviderStatsQueryDto,
  CopySignalDto,
} from './dto';

@Controller('signals')
export class SignalsController {
  constructor(
    private signalPerformanceService: SignalPerformanceService,
    private providerStatsService: ProviderStatsService,
    @InjectQueue(SIGNAL_TRACKING_QUEUE) private signalTrackingQueue: Queue,
  ) {}

  // ============ SIGNAL ENDPOINTS ============

  @Post()
  async createSignal(@Body() dto: CreateSignalDto) {
    const signal = await this.signalPerformanceService.createSignal(dto);

    await this.providerStatsService.onSignalCreated(dto.providerId);

    return signal;
  }

  @Get()
  async listSignals(@Query() query: SignalQueryDto) {
    return this.signalPerformanceService.listSignals(query);
  }

  @Get('stats')
  async getSignalStats() {
    return this.signalPerformanceService.getSignalStats();
  }

  @Get('active')
  async getActiveSignals() {
    return this.signalPerformanceService.getActiveSignals();
  }

  @Get(':id')
  async getSignal(@Param('id', ParseUUIDPipe) id: string) {
    return this.signalPerformanceService.getSignal(id);
  }

  @Put(':id')
  async updateSignal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSignalDto,
  ) {
    return this.signalPerformanceService.updateSignal(id, dto);
  }

  @Post(':id/copy')
  async copySignal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CopySignalDto,
  ) {
    return this.signalPerformanceService.incrementCopiers(id, dto.volume);
  }

  // ============ PERFORMANCE ENDPOINTS ============

  @Get(':id/performance')
  async getPerformanceHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PerformanceQueryDto,
  ) {
    return this.signalPerformanceService.getPerformanceHistory(id, query);
  }

  @Post(':id/track')
  async trackSignal(@Param('id', ParseUUIDPipe) id: string) {
    const performance = await this.signalPerformanceService.recordPerformance(id);
    const outcome = await this.signalPerformanceService.checkSignalOutcome(id);

    return {
      performance,
      ...outcome,
    };
  }

  // ============ PROVIDER ENDPOINTS ============

  @Get('providers/stats')
  async listProviderStats(@Query() query: ProviderStatsQueryDto) {
    return this.providerStatsService.listProviderStats(query);
  }

  @Get('providers/leaderboard')
  async getLeaderboard(@Query('limit') limit?: number) {
    return this.providerStatsService.getLeaderboard(limit || 10);
  }

  @Get('providers/:providerId/stats')
  async getProviderStats(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.providerStatsService.getProviderStats(providerId);
  }

  @Get('providers/:providerId/signals')
  async getProviderSignals(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.signalPerformanceService.getSignalsByProvider(providerId);
  }

  @Post('providers/:providerId/recalculate')
  async recalculateProviderStats(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.providerStatsService.recalculateAllStats(providerId);
  }

  // ============ JOB ENDPOINTS ============

  @Post('jobs/track-all')
  async triggerTrackAllSignals(@Query('batchSize') batchSize?: number) {
    const job = await this.signalTrackingQueue.add('track-all-signals', {
      batchSize: batchSize || 50,
    });

    return {
      jobId: job.id,
      message: 'Signal tracking job queued',
    };
  }

  @Post('jobs/cleanup-expired')
  async triggerCleanupExpired() {
    const job = await this.signalTrackingQueue.add('cleanup-expired-signals', {});

    return {
      jobId: job.id,
      message: 'Cleanup expired signals job queued',
    };
  }

  @Get('jobs/:jobId/status')
  async getJobStatus(@Param('jobId') jobId: string) {
    const job = await this.signalTrackingQueue.getJob(jobId);

    if (!job) {
      return { status: 'not_found' };
    }

    const state = await job.getState();
    const progress = job.progress();

    return {
      id: job.id,
      state,
      progress,
      data: job.data,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
    
  Body,
  Param,
  Delete,
  Query,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SignalsService } from './signals.service';
import { CreateSignalDto } from './dto/signals.dto';
import { SignalStatus } from './entities/signal.entity';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Post()
  create(@Body() createSignalDto: CreateSignalDto) {
    return this.signalsService.create(createSignalDto);
  }

  @Get()
  findAll(@Query('status') status?: SignalStatus) {
    return this.signalsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.signalsService.findOne(id);
  }

  @Patch(':id/performance')
  updatePerformance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() metrics: { total_profit_loss: number; success_rate: number; executed_count: number },
  ) {
    return this.signalsService.updatePerformance(id, metrics);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.signalsService.remove(id);
 main
  }
}
