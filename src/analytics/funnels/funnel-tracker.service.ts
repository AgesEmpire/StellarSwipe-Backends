import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Funnel } from './entities/funnel.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { UserFunnelProgress } from './entities/user-funnel-progress.entity';
import { FunnelConfigDto } from './dto/funnel-config.dto';
import { FunnelAnalysisDto, StepAnalysisDto } from './dto/funnel-analysis.dto';
import { ConversionReportDto } from './dto/conversion-report.dto';
import { calculateConversionRate } from './utils/conversion-calculator';
import { analyzeDropOffs, findBiggestDropOff } from './utils/drop-off-analyzer';

@Injectable()
export class FunnelTrackerService {
  constructor(
    @InjectRepository(Funnel) private readonly funnelRepo: Repository<Funnel>,
    @InjectRepository(FunnelStep) private readonly stepRepo: Repository<FunnelStep>,
    @InjectRepository(UserFunnelProgress)
    private readonly progressRepo: Repository<UserFunnelProgress>,
  ) {}

  async createFunnel(dto: FunnelConfigDto): Promise<Funnel> {
    const funnel = this.funnelRepo.create({ name: dto.name });
    const saved = await this.funnelRepo.save(funnel);

    const steps = dto.steps.map((s) =>
      this.stepRepo.create({
        funnel: saved,
        key: s.key,
        name: s.name,
        stepOrder: s.order,
        description: s.description,
      }),
    );
    await this.stepRepo.save(steps);
    return this.funnelRepo.findOneOrFail({ where: { id: saved.id } });
  }

  async recordStep(userId: string, funnelName: string, stepKey: string): Promise<void> {
    const funnel = await this.funnelRepo.findOne({ where: { name: funnelName, isActive: true } });
    if (!funnel) return;

    const step = funnel.steps.find((s) => s.key === stepKey);
    if (!step) return;

    let progress = await this.progressRepo.findOne({
      where: { userId, funnel: { id: funnel.id } },
      relations: ['funnel'],
    });

    if (!progress) {
      progress = this.progressRepo.create({
        userId,
        funnel,
        currentStep: step.stepOrder,
        completedSteps: [stepKey],
        lastActivityAt: new Date(),
      });
    } else {
      if (!progress.completedSteps.includes(stepKey)) {
        progress.completedSteps = [...progress.completedSteps, stepKey];
      }
      progress.currentStep = Math.max(progress.currentStep, step.stepOrder);
      progress.lastActivityAt = new Date();

      const allStepKeys = funnel.steps.map((s) => s.key);
      if (allStepKeys.every((k) => progress!.completedSteps.includes(k))) {
        progress.completedAt = new Date();
      }
    }

    await this.progressRepo.save(progress);
  }

  async analyzeFunnel(funnelId: string): Promise<FunnelAnalysisDto> {
    const funnel = await this.funnelRepo.findOne({ where: { id: funnelId } });
    if (!funnel) throw new NotFoundException('Funnel not found');

    const totalEntered = await this.progressRepo.count({ where: { funnel: { id: funnelId } } });
    const totalCompleted = await this.progressRepo.count({
      where: { funnel: { id: funnelId }, completedAt: Between(new Date(0), new Date()) },
    });

    const sortedSteps = [...funnel.steps].sort((a, b) => a.stepOrder - b.stepOrder);

    const stepDtos: StepAnalysisDto[] = await Promise.all(
      sortedSteps.map(async (step, index) => {
        const usersReached = await this.progressRepo
          .createQueryBuilder('p')
          .where('p.funnel_id = :funnelId', { funnelId })
          .andWhere(':key = ANY(p.completed_steps)', { key: step.key })
          .getCount();

        const prevCount = index === 0 ? totalEntered : await this.progressRepo
          .createQueryBuilder('p')
          .where('p.funnel_id = :funnelId', { funnelId })
          .andWhere(':key = ANY(p.completed_steps)', { key: sortedSteps[index - 1].key })
          .getCount();

        const conversionRate = calculateConversionRate(prevCount, usersReached);
        return {
          stepKey: step.key,
          stepName: step.name,
          order: step.stepOrder,
          usersEntered: prevCount,
          usersCompleted: usersReached,
          conversionRate,
          dropOffRate: parseFloat((100 - conversionRate).toFixed(2)),
        };
      }),
    );

    return {
      funnelId,
      funnelName: funnel.name,
      totalUsersEntered: totalEntered,
      totalUsersCompleted: totalCompleted,
      overallConversionRate: calculateConversionRate(totalEntered, totalCompleted),
      steps: stepDtos,
      analyzedAt: new Date(),
    };
  }

  async getConversionReport(funnelId: string, from: Date, to: Date): Promise<ConversionReportDto> {
    const analysis = await this.analyzeFunnel(funnelId);
    const funnel = await this.funnelRepo.findOneOrFail({ where: { id: funnelId } });

    const entered = await this.progressRepo.count({
      where: { funnel: { id: funnelId }, enteredAt: Between(from, to) },
    });
    const converted = await this.progressRepo
      .createQueryBuilder('p')
      .where('p.funnel_id = :funnelId', { funnelId })
      .andWhere('p.completed_at BETWEEN :from AND :to', { from, to })
      .getCount();

    const dropOffs = analyzeDropOffs(analysis.steps);

    return {
      funnelId,
      funnelName: funnel.name,
      period: { from, to },
      totalEntered: entered,
      totalConverted: converted,
      overallConversionRate: calculateConversionRate(entered, converted),
      biggestDropOff: findBiggestDropOff(dropOffs),
      dropOffPoints: dropOffs,
      generatedAt: new Date(),
    };
  }

  async markDropOff(userId: string, funnelName: string): Promise<void> {
    const funnel = await this.funnelRepo.findOne({ where: { name: funnelName } });
    if (!funnel) return;

    const progress = await this.progressRepo.findOne({
      where: { userId, funnel: { id: funnel.id } },
    });
    if (progress && !progress.completedAt) {
      progress.droppedAtStep = progress.currentStep;
      await this.progressRepo.save(progress);
    }
  }
}
