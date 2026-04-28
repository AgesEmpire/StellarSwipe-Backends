import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { ProfileSession, ProfileSessionStatus, ProfileSessionType } from './entities/profile-session.entity';
import { PerformanceSnapshot, SnapshotType } from './entities/performance-snapshot.entity';

import { ProfileConfigDto } from './dto/profile-config.dto';
import { PerformanceReportDto } from './dto/performance-report.dto';

import { CpuProfiler, CpuSample } from './collectors/cpu-profiler';
import { MemoryProfiler, MemorySample } from './collectors/memory-profiler';
import { QueryProfiler, QuerySample } from './collectors/query-profiler';
import { ApiProfiler, ApiSample } from './collectors/api-profiler';
import { BottleneckDetector } from './analyzers/bottleneck-detector';
import { FlameGraphGenerator } from './analyzers/flamegraph-generator';
import { TraceAggregator } from './utils/trace-aggregator';

interface ActiveSession {
  abortController: AbortController;
  config: ProfileConfigDto;
  cpuSamples: CpuSample[];
  memorySamples: MemorySample[];
  startedAt: Date;
}

@Injectable()
export class ProfilerService implements OnModuleDestroy {
  private readonly logger = new Logger(ProfilerService.name);
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(
    @InjectRepository(ProfileSession)
    private readonly sessionRepo: Repository<ProfileSession>,
    @InjectRepository(PerformanceSnapshot)
    private readonly snapshotRepo: Repository<PerformanceSnapshot>,

    private readonly cpuProfiler: CpuProfiler,
    private readonly memoryProfiler: MemoryProfiler,
    private readonly queryProfiler: QueryProfiler,
    readonly apiProfiler: ApiProfiler,
    private readonly bottleneckDetector: BottleneckDetector,
    private readonly flameGraphGenerator: FlameGraphGenerator,
    private readonly traceAggregator: TraceAggregator,
    private readonly configService: ConfigService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const [sessionId] of this.activeSessions) {
      await this.cancelSession(sessionId).catch(() => {});
    }
  }

  // ─── Start a profiling session ───────────────────────────────────────────

  async startSession(dto: ProfileConfigDto, triggeredBy?: string): Promise<ProfileSession> {
    this.logger.log(`Starting profiling session: ${dto.name} [${dto.type}]`);

    const session = this.sessionRepo.create({
      name: dto.name,
      type: dto.type ?? ProfileSessionType.FULL,
      status: ProfileSessionStatus.ACTIVE,
      durationSeconds: dto.durationSeconds ?? 60,
      samplingIntervalMs: dto.samplingIntervalMs ?? 1000,
      config: dto,
      startedAt: new Date(),
      triggeredBy,
      environment: this.configService.get('NODE_ENV', 'production'),
      appVersion: this.configService.get('APP_VERSION', '1.0.0'),
    });

    await this.sessionRepo.save(session);

    const abortController = new AbortController();
    const activeData: ActiveSession = {
      abortController,
      config: dto,
      cpuSamples: [],
      memorySamples: [],
      startedAt: new Date(),
    };

    this.activeSessions.set(session.id, activeData);

    this.runSession(session.id, dto, abortController.signal, activeData).catch((err) => {
      this.logger.error(`Session ${session.id} failed: ${err.message}`, err.stack);
    });

    return session;
  }

  // ─── Run the actual collection loop ──────────────────────────────────────

  private async runSession(
    sessionId: string,
    config: ProfileConfigDto,
    signal: AbortSignal,
    state: ActiveSession,
  ): Promise<void> {
    const durationMs = (config.durationSeconds ?? 60) * 1000;
    const intervalMs = config.samplingIntervalMs ?? 1000;
    const type = config.type ?? ProfileSessionType.FULL;

    try {
      // Configure sub-profilers
      this.queryProfiler.configure({
        slowQueryThresholdMs: config.slowQueryThresholdMs ?? 100,
      });
      this.apiProfiler.configure({
        slowApiThresholdMs: config.slowApiThresholdMs ?? 500,
      });

      const collectCpu = [ProfileSessionType.CPU, ProfileSessionType.FULL].includes(type);
      const collectMem = [ProfileSessionType.MEMORY, ProfileSessionType.FULL].includes(type);
      const collectQuery = [ProfileSessionType.QUERY, ProfileSessionType.FULL].includes(type);
      const collectApi = [ProfileSessionType.API, ProfileSessionType.FULL].includes(type);

      if (collectQuery) this.queryProfiler.startRecording();
      if (collectApi) this.apiProfiler.startRecording();

      const collectors: Promise<void>[] = [];

      if (collectCpu) {
        collectors.push(
          this.cpuProfiler.collectSamples(
            durationMs,
            intervalMs,
            (s) => {
              state.cpuSamples.push(s);
              this.persistSnapshot(sessionId, SnapshotType.CPU, s.snapshot, s.snapshot.usagePercent);
            },
            signal,
          ),
        );
      }

      if (collectMem) {
        collectors.push(
          this.memoryProfiler.collectSamples(
            durationMs,
            intervalMs,
            (s) => {
              state.memorySamples.push(s);
              this.persistSnapshot(sessionId, SnapshotType.MEMORY, s.snapshot, s.snapshot.heapUsedMb);
            },
            signal,
          ),
        );
      }

      await Promise.all(collectors);

      // Stop query / API recorders
      const querySamples: QuerySample[] = collectQuery
        ? this.queryProfiler.stopRecording()
        : [];
      const apiSamples: ApiSample[] = collectApi
        ? this.apiProfiler.stopRecording()
        : [];

      // Persist query/API snapshots
      for (const s of querySamples) {
        await this.persistSnapshot(sessionId, SnapshotType.QUERY, s.snapshot, s.snapshot.durationMs, s.snapshot.isSlow);
      }
      for (const s of apiSamples) {
        await this.persistSnapshot(sessionId, SnapshotType.API, s.snapshot, s.snapshot.durationMs);
      }

      if (!signal.aborted) {
        await this.finaliseSession(sessionId, state, querySamples, apiSamples);
      }
    } catch (err) {
      this.logger.error(`Session ${sessionId} error: ${err.message}`);
      await this.sessionRepo.update(sessionId, {
        status: ProfileSessionStatus.FAILED,
        errorMessage: err.message,
        completedAt: new Date(),
      });
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  private async finaliseSession(
    sessionId: string,
    state: ActiveSession,
    querySamples: QuerySample[],
    apiSamples: ApiSample[],
  ): Promise<void> {
    const cpuStats = this.cpuProfiler.computeStats(state.cpuSamples);
    const memStats = this.memoryProfiler.computeStats(state.memorySamples);
    const queryStats = this.queryProfiler.computeStats(querySamples);
    const apiStats = this.apiProfiler.computeStats(apiSamples);

    const leakInfo = this.memoryProfiler.detectLeaks(state.memorySamples);
    const bottlenecks = this.bottleneckDetector.analyzeAll({
      cpuSamples: state.cpuSamples,
      memorySamples: state.memorySamples,
      querySamples,
      apiSamples,
    });

    const summary = {
      avgCpuUsage: cpuStats.avg,
      peakCpuUsage: cpuStats.peak,
      avgMemoryMb: memStats.avg,
      peakMemoryMb: memStats.peak,
      totalQueries: queryStats.total,
      slowQueriesCount: queryStats.slowCount,
      avgQueryMs: queryStats.avgMs,
      p95QueryMs: queryStats.p95Ms,
      totalApiRequests: apiStats.total,
      avgApiResponseMs: apiStats.avgMs,
      p99ApiResponseMs: apiStats.p99Ms,
      bottlenecksDetected: bottlenecks.length,
      heapLeakSuspected: leakInfo.leakSuspected,
    };

    await this.sessionRepo.update(sessionId, {
      status: ProfileSessionStatus.COMPLETED,
      completedAt: new Date(),
      summary,
    });

    this.logger.log(
      `Session ${sessionId} completed. Bottlenecks: ${bottlenecks.length}, Heap leak: ${leakInfo.leakSuspected}`,
    );
  }

  // ─── Cancel an active session ─────────────────────────────────────────────

  async cancelSession(sessionId: string): Promise<void> {
    const state = this.activeSessions.get(sessionId);
    if (!state) throw new NotFoundException(`No active session: ${sessionId}`);

    state.abortController.abort();
    this.activeSessions.delete(sessionId);

    await this.sessionRepo.update(sessionId, {
      status: ProfileSessionStatus.CANCELLED,
      completedAt: new Date(),
    });

    this.queryProfiler.stopRecording();
    this.apiProfiler.stopRecording();

    this.logger.log(`Session ${sessionId} cancelled`);
  }

  // ─── Generate a full report for a completed session ───────────────────────

  async generateReport(sessionId: string): Promise<PerformanceReportDto> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['snapshots'],
    });
    if (!session) throw new NotFoundException(`Session not found: ${sessionId}`);

    if (session.status === ProfileSessionStatus.ACTIVE) {
      throw new BadRequestException('Session is still running. Wait for it to complete.');
    }

    const snapshots = session.snapshots ?? [];

    const cpuSnaps = snapshots.filter((s) => s.type === SnapshotType.CPU);
    const memSnaps = snapshots.filter((s) => s.type === SnapshotType.MEMORY);
    const querySnaps = snapshots.filter((s) => s.type === SnapshotType.QUERY);
    const apiSnaps = snapshots.filter((s) => s.type === SnapshotType.API);

    // Re-hydrate typed samples from persisted snapshots
    const cpuSamples: CpuSample[] = cpuSnaps.map((s) => ({
      timestamp: s.capturedAt,
      snapshot: s.data as any,
    }));
    const memorySamples: MemorySample[] = memSnaps.map((s) => ({
      timestamp: s.capturedAt,
      snapshot: s.data as any,
    }));
    const querySamples: QuerySample[] = querySnaps.map((s) => ({
      timestamp: s.capturedAt,
      snapshot: s.data as any,
    }));
    const apiSamples: ApiSample[] = apiSnaps.map((s) => ({
      timestamp: s.capturedAt,
      snapshot: s.data as any,
    }));

    const cpuStats = this.cpuProfiler.computeStats(cpuSamples);
    const memStats = this.memoryProfiler.computeStats(memorySamples);
    const queryStats = this.queryProfiler.computeStats(querySamples);
    const apiStats = this.apiProfiler.computeStats(apiSamples);
    const leakInfo = this.memoryProfiler.detectLeaks(memorySamples);
    const bottlenecks = this.bottleneckDetector.analyzeAll({
      cpuSamples,
      memorySamples,
      querySamples,
      apiSamples,
    });
    const flameData = this.flameGraphGenerator.generate(cpuSamples);
    const traceData = this.traceAggregator.aggregate({
      cpuSamples,
      memorySamples,
      querySamples,
      apiSamples,
    });

    const report: PerformanceReportDto = {
      sessionId: session.id,
      sessionName: session.name,
      type: session.type,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      durationSeconds: session.durationSeconds,
      environment: session.environment,
      appVersion: session.appVersion,
      summary: {
        avgCpuUsage: cpuStats.avg,
        peakCpuUsage: cpuStats.peak,
        p95CpuUsage: 0, // computed below
        avgMemoryMb: memStats.avg,
        peakMemoryMb: memStats.peak,
        heapGrowthMb: memStats.growthMb,
        heapLeakSuspected: leakInfo.leakSuspected,
        totalQueries: queryStats.total,
        slowQueriesCount: queryStats.slowCount,
        avgQueryMs: queryStats.avgMs,
        p95QueryMs: queryStats.p95Ms,
        p99QueryMs: queryStats.p99Ms,
        uniqueSlowQueries: this.queryProfiler.aggregateSlowQueries(querySamples).length,
        totalApiRequests: apiStats.total,
        avgApiResponseMs: apiStats.avgMs,
        p95ApiResponseMs: apiStats.p95Ms,
        p99ApiResponseMs: apiStats.p99Ms,
        errorRate: apiStats.errorRate,
        slowEndpointsCount: this.apiProfiler
          .aggregateEndpoints(apiSamples)
          .filter((e) => e.avgDurationMs >= (session.config?.slowApiThresholdMs ?? 500)).length,
      },
      bottlenecks,
      cpu: cpuSamples.length
        ? {
            samples: cpuSamples.slice(0, 500).map((s) => ({
              timestamp: s.timestamp,
              usagePercent: s.snapshot.usagePercent,
              loadAvg1m: s.snapshot.loadAvg1m,
            })),
            peakAt: cpuStats.peakAt,
            peakValue: cpuStats.peak,
            hotspots: flameData.hotspots,
            flameGraphData: {
              collapsed: this.flameGraphGenerator.toCollapsedFormat(flameData),
              totalSamples: flameData.totalSamples,
            },
          }
        : undefined,
      memory: memorySamples.length
        ? {
            samples: memorySamples.slice(0, 500).map((s) => ({
              timestamp: s.timestamp,
              heapUsedMb: s.snapshot.heapUsedMb,
              rssMs: s.snapshot.rssMs,
            })),
            peakAt: memStats.peakAt,
            peakHeapMb: memStats.peak,
            leakIndicators: leakInfo.indicators,
          }
        : undefined,
      queries: querySamples.length
        ? {
            slowestQueries: this.queryProfiler.aggregateSlowQueries(querySamples).slice(0, 20),
            queryDistribution: this.buildQueryDistribution(querySamples),
            indexSuggestions: this.buildIndexSuggestions(querySamples),
          }
        : undefined,
      api: apiSamples.length
        ? {
            slowestEndpoints: this.apiProfiler.aggregateEndpoints(apiSamples).slice(0, 20),
            statusCodeDistribution: this.apiProfiler.getStatusCodeDistribution(apiSamples),
            throughputPerMinute: apiStats.throughputPerMin,
          }
        : undefined,
      traceAggregation: {
        timeline: traceData.timeline.slice(0, 200),
        correlatedAnomalies: traceData.correlatedAnomalies,
        sessionStats: traceData.sessionStats,
      },
      generatedAt: new Date(),
    };

    return report;
  }

  // ─── List sessions ────────────────────────────────────────────────────────

  async listSessions(
    limit = 20,
    offset = 0,
    status?: ProfileSessionStatus,
  ): Promise<{ sessions: ProfileSession[]; total: number }> {
    const where = status ? { status } : {};
    const [sessions, total] = await this.sessionRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      select: ['id', 'name', 'type', 'status', 'durationSeconds', 'summary', 'startedAt', 'completedAt', 'createdAt'],
    });
    return { sessions, total };
  }

  async getSession(sessionId: string): Promise<ProfileSession> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`Session not found: ${sessionId}`);
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session.status === ProfileSessionStatus.ACTIVE) {
      throw new BadRequestException('Cannot delete an active session. Cancel it first.');
    }
    await this.sessionRepo.delete(sessionId);
  }

  getActiveSessionIds(): string[] {
    return [...this.activeSessions.keys()];
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async persistSnapshot(
    sessionId: string,
    type: SnapshotType,
    data: any,
    valueNumeric?: number,
    isAnomaly = false,
  ): Promise<void> {
    try {
      await this.snapshotRepo.save(
        this.snapshotRepo.create({
          sessionId,
          type,
          data,
          valueNumeric,
          isAnomaly,
          capturedAt: new Date(),
        }),
      );
    } catch (err) {
      this.logger.warn(`Failed to persist snapshot: ${err.message}`);
    }
  }

  private buildQueryDistribution(samples: QuerySample[]): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const s of samples) {
      dist[s.snapshot.operation] = (dist[s.snapshot.operation] ?? 0) + 1;
    }
    return dist;
  }

  private buildIndexSuggestions(samples: QuerySample[]): string[] {
    const slowByTable = new Map<string, number>();
    for (const s of samples.filter((x) => x.snapshot.isSlow && x.snapshot.table)) {
      slowByTable.set(s.snapshot.table!, (slowByTable.get(s.snapshot.table!) ?? 0) + 1);
    }

    return Array.from(slowByTable.entries())
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(
        ([table, count]) =>
          `Consider adding an index on "${table}" — ${count} slow queries detected`,
      );
  }
}
