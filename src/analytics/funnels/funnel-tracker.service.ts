import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Funnel } from './entities/funnel.entity';
import { UserFunnelProgress } from './entities/user-funnel-progress.entity';
import { TrackFunnelStepDto } from './dto/funnel-config.dto';
import { FunnelAnalysisDto, FunnelAnalysisResult } from './dto/funnel-analysis.dto';
import { ConversionReportDto } from './dto/conversion-report.dto';
import { USER_ACQUISITION_FUNNEL } from './interfaces/funnel-step.interface';
import { calculateConversionRates, getTopDropOffPoints } from './utils/conversion-calculator';
import { analyzeDropOffs } from './utils/drop-off-analyzer';

@Injectable()
export class FunnelTrackerService {
  private readonly logger = new Logger(FunnelTrackerService.name);

  constructor(
    @InjectRepository(Funnel)
    private readonly funnelRepo: Repository<Funnel>,
    @InjectRepository(UserFunnelProgress)
    private readonly progressRepo: Repository<UserFunnelProgress>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultFunnel();
  }

  private async seedDefaultFunnel() {
    const exists = await this.funnelRepo.findOne({
      where: { name: USER_ACQUISITION_FUNNEL.name },
    });
    if (!exists) {
      await this.funnelRepo.save(
        this.funnelRepo.create({
          name: USER_ACQUISITION_FUNNEL.name,
          steps: USER_ACQUISITION_FUNNEL.steps,
        }),
      );
    }
  }

  async trackStep(dto: TrackFunnelStepDto): Promise<UserFunnelProgress> {
    const funnel = await this.funnelRepo.findOne({ where: { name: dto.funnelName } });
    if (!funnel) throw new NotFoundException(`Funnel "${dto.funnelName}" not found`);

    const steps = [...funnel.steps].sort((a, b) => a.order - b.order);
    const stepDef = steps.find((s) => s.key === dto.stepKey);
    if (!stepDef) throw new NotFoundException(`Step "${dto.stepKey}" not found in funnel`);

    let progress = await this.progressRepo.findOne({
      where: { userId: dto.userId, funnelName: dto.funnelName },
    });

    if (!progress) {
      progress = this.progressRepo.create({
        userId: dto.userId,
        funnelName: dto.funnelName,
        currentStep: dto.stepKey,
        completedSteps: [],
      });
    }

    const alreadyCompleted = progress.completedSteps.some((s) => s.key === dto.stepKey);
    if (!alreadyCompleted) {
      progress.completedSteps = [
        ...progress.completedSteps,
        { key: dto.stepKey, completedAt: new Date().toISOString() },
      ];
      progress.currentStep = dto.stepKey;

      const lastStep = steps[steps.length - 1];
      if (dto.stepKey === lastStep.key) {
        progress.isConverted = true;
        progress.convertedAt = new Date();
      }
    }

    return this.progressRepo.save(progress);
  }

  async analyzeFunnel(dto: FunnelAnalysisDto): Promise<FunnelAnalysisResult> {
    const funnel = await this.funnelRepo.findOne({ where: { name: dto.funnelName } });
    if (!funnel) throw new NotFoundException(`Funnel "${dto.funnelName}" not found`);

    const where: Record<string, unknown> = { funnelName: dto.funnelName };
    if (dto.from && dto.to) {
      where['createdAt'] = Between(new Date(dto.from), new Date(dto.to));
    }

    const records = await this.progressRepo.find({ where });
    const totalEntries = records.length;
    const totalConversions = records.filter((r) => r.isConverted).length;

    const stepCounts = new Map<string, number>();
    for (const record of records) {
      for (const completed of record.completedSteps) {
        stepCounts.set(completed.key, (stepCounts.get(completed.key) ?? 0) + 1);
      }
    }

    const steps = calculateConversionRates(stepCounts, funnel.steps, totalEntries);

    return {
      funnelName: dto.funnelName,
      totalEntries,
      totalConversions,
      overallConversionRate:
        totalEntries > 0 ? Math.round((totalConversions / totalEntries) * 10000) / 100 : 0,
      steps,
      period: dto.from && dto.to ? { from: dto.from, to: dto.to } : undefined,
    };
  }

  async getConversionReport(funnelName: string, from: string, to: string): Promise<ConversionReportDto> {
    const analysis = await this.analyzeFunnel({ funnelName, from, to });
    const records = await this.progressRepo.find({
      where: { funnelName, createdAt: Between(new Date(from), new Date(to)) },
    });

    const dropOffPoints = getTopDropOffPoints(analysis.steps);
    const dropOffSummary = analyzeDropOffs(records, analysis.totalEntries);

    const convertedRecords = records.filter((r) => r.isConverted && r.convertedAt);
    const avgTimeToConvert =
      convertedRecords.length > 0
        ? convertedRecords.reduce((sum, r) => {
            return sum + (r.convertedAt!.getTime() - r.createdAt.getTime());
          }, 0) /
          convertedRecords.length /
          1000 /
          60
        : undefined;

    this.logger.log(
      `Conversion report for "${funnelName}": ${analysis.overallConversionRate}% conversion rate`,
    );

    return {
      funnelName,
      period: { from, to },
      totalUsers: analysis.totalEntries,
      convertedUsers: analysis.totalConversions,
      overallConversionRate: analysis.overallConversionRate,
      dropOffPoints: dropOffPoints.map((d) => ({
        ...d,
        dropOffCount:
          dropOffSummary.find((s) => s.stepKey === d.stepKey)?.count ?? d.dropOffCount,
      })),
      avgTimeToConvert,
    };
  }

  async getUserProgress(userId: string, funnelName: string): Promise<UserFunnelProgress | null> {
    return this.progressRepo.findOne({ where: { userId, funnelName } });
  }
}
