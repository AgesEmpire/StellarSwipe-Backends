import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TradeSagaEntity,
  SagaStatus,
  SagaStepStatus,
  SagaStepRecord,
} from './trade-saga.entity';

// ── Step definition ─────────────────────────────────────────────────────────

/**
 * A single step in the trade saga.
 * `execute` mutates state; `compensate` reverses it.
 * Both receive the accumulated saga context so compensations can use
 * identifiers created earlier in the flow (e.g. tradeId, txHash).
 */
export interface SagaStep<TCtx> {
  name: string;
  execute: (ctx: TCtx) => Promise<Partial<TCtx>>;
  compensate: (ctx: TCtx) => Promise<void>;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

@Injectable()
export class TradeSagaOrchestrator {
  private readonly logger = new Logger(TradeSagaOrchestrator.name);

  constructor(
    @InjectRepository(TradeSagaEntity)
    private readonly sagaRepo: Repository<TradeSagaEntity>,
  ) {}

  /**
   * Runs a sequence of saga steps in order.
   *
   * On success every step's result is merged into `ctx` and the saga is
   * persisted as COMPLETED.
   *
   * On failure of step N the orchestrator runs compensations for steps
   * N-1 … 0 in reverse order, persists the outcome, then re-throws the
   * original error so the caller still sees a clear exception.
   */
  async run<TCtx extends Record<string, unknown>>(
    saga: TradeSagaEntity,
    steps: SagaStep<TCtx>[],
    initialCtx: TCtx,
  ): Promise<TCtx> {
    let ctx: TCtx = { ...initialCtx };
    const completedSteps: Array<{ step: SagaStep<TCtx>; ctx: TCtx }> = [];

    for (const step of steps) {
      try {
        this.logger.log(`[${saga.traceId}] Executing saga step: ${step.name}`);
        const patch = await step.execute(ctx);
        ctx = { ...ctx, ...patch };

        completedSteps.push({ step, ctx: { ...ctx } });
        await this.recordStepCompleted(saga, step.name, ctx);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[${saga.traceId}] Step "${step.name}" failed: ${errMsg}. Starting compensation.`,
        );

        await this.recordStepFailed(saga, step.name, errMsg);
        await this.compensate(saga, completedSteps, ctx);

        throw error;
      }
    }

    await this.markCompleted(saga, ctx);
    return ctx;
  }

  // ── Compensation ──────────────────────────────────────────────────────────

  private async compensate<TCtx extends Record<string, unknown>>(
    saga: TradeSagaEntity,
    completedSteps: Array<{ step: SagaStep<TCtx>; ctx: TCtx }>,
    finalCtx: TCtx,
  ): Promise<void> {
    await this.markCompensating(saga);

    const reversed = [...completedSteps].reverse();
    const failedCompensations: string[] = [];

    for (const { step } of reversed) {
      try {
        this.logger.log(
          `[${saga.traceId}] Compensating step: ${step.name}`,
        );
        await step.compensate(finalCtx);
        await this.recordStepCompensated(saga, step.name);
      } catch (compError) {
        const msg =
          compError instanceof Error ? compError.message : String(compError);
        this.logger.error(
          `[${saga.traceId}] Compensation of "${step.name}" failed: ${msg}`,
        );
        failedCompensations.push(`${step.name}: ${msg}`);
      }
    }

    if (failedCompensations.length > 0) {
      await this.markFailedToCompensate(
        saga,
        `Failed to compensate: ${failedCompensations.join('; ')}`,
      );
    } else {
      await this.markCompensated(saga);
    }
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  async createSaga(
    userId: string,
    traceId: string,
    payload?: Record<string, unknown>,
  ): Promise<TradeSagaEntity> {
    const saga = this.sagaRepo.create({
      userId,
      traceId,
      status: SagaStatus.RUNNING,
      steps: [],
      payload,
    });
    return this.sagaRepo.save(saga);
  }

  private async recordStepCompleted<TCtx extends Record<string, unknown>>(
    saga: TradeSagaEntity,
    stepName: string,
    ctx: TCtx,
  ): Promise<void> {
    const record: SagaStepRecord = {
      step: stepName,
      status: SagaStepStatus.COMPLETED,
      completedAt: new Date().toISOString(),
      metadata: { tradeId: ctx['tradeId'], txHash: ctx['txHash'] } as Record<string, unknown>,
    };
    saga.steps = [...saga.steps, record];
    // Persist tradeId on the saga entity once it is created
    if (ctx['tradeId'] && !saga.tradeId) {
      saga.tradeId = ctx['tradeId'] as string;
    }
    await this.sagaRepo.save(saga);
  }

  private async recordStepFailed(
    saga: TradeSagaEntity,
    stepName: string,
    error: string,
  ): Promise<void> {
    const record: SagaStepRecord = {
      step: stepName,
      status: SagaStepStatus.FAILED,
      error,
    };
    saga.steps = [...saga.steps, record];
    await this.sagaRepo.save(saga);
  }

  private async recordStepCompensated(
    saga: TradeSagaEntity,
    stepName: string,
  ): Promise<void> {
    saga.steps = saga.steps.map((s) =>
      s.step === stepName && s.status === SagaStepStatus.COMPLETED
        ? { ...s, status: SagaStepStatus.COMPENSATED, compensatedAt: new Date().toISOString() }
        : s,
    );
    await this.sagaRepo.save(saga);
  }

  private async markCompensating(saga: TradeSagaEntity): Promise<void> {
    saga.status = SagaStatus.COMPENSATING;
    await this.sagaRepo.save(saga);
  }

  private async markCompensated(saga: TradeSagaEntity): Promise<void> {
    saga.status = SagaStatus.COMPENSATED;
    saga.outcomeMessage = 'All completed steps compensated successfully';
    await this.sagaRepo.save(saga);
  }

  private async markFailedToCompensate(
    saga: TradeSagaEntity,
    message: string,
  ): Promise<void> {
    saga.status = SagaStatus.FAILED_TO_COMPENSATE;
    saga.outcomeMessage = message;
    await this.sagaRepo.save(saga);
  }

  private async markCompleted<TCtx extends Record<string, unknown>>(
    saga: TradeSagaEntity,
    ctx: TCtx,
  ): Promise<void> {
    saga.status = SagaStatus.COMPLETED;
    saga.outcomeMessage = 'Trade saga completed successfully';
    if (ctx['tradeId'] && !saga.tradeId) {
      saga.tradeId = ctx['tradeId'] as string;
    }
    await this.sagaRepo.save(saga);
  }
}
