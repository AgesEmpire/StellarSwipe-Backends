import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeSagaOrchestrator, SagaStep } from './trade-saga.orchestrator';
import {
  TradeSagaEntity,
  SagaStatus,
  SagaStepStatus,
} from './trade-saga.entity';

// ── Helpers ───────────────────────────────────────────────────────────────────

type Ctx = Record<string, unknown>;

function makeStep(
  name: string,
  executeFn: (ctx: Ctx) => Promise<Partial<Ctx>>,
  compensateFn: (ctx: Ctx) => Promise<void> = async () => {},
): SagaStep<Ctx> {
  return { name, execute: executeFn, compensate: compensateFn };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TradeSagaOrchestrator', () => {
  let orchestrator: TradeSagaOrchestrator;
  let sagaRepo: jest.Mocked<Repository<TradeSagaEntity>>;

  const mockSaga = (): TradeSagaEntity =>
    ({
      id: 'saga-1',
      traceId: 'trace-1',
      userId: 'user-1',
      status: SagaStatus.RUNNING,
      steps: [],
    } as unknown as TradeSagaEntity);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeSagaOrchestrator,
        {
          provide: getRepositoryToken(TradeSagaEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn().mockImplementation(async (e) => e),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    orchestrator = module.get(TradeSagaOrchestrator);
    sagaRepo = module.get(getRepositoryToken(TradeSagaEntity));
  });

  describe('run – happy path', () => {
    it('executes all steps in order and marks saga COMPLETED', async () => {
      const order: string[] = [];
      const steps: SagaStep<Ctx>[] = [
        makeStep('step_a', async () => { order.push('exec:a'); return { a: true }; }),
        makeStep('step_b', async () => { order.push('exec:b'); return { b: true }; }),
        makeStep('step_c', async () => { order.push('exec:c'); return { c: true }; }),
      ];

      const saga = mockSaga();
      const ctx = await orchestrator.run(saga, steps, { userId: 'u1' });

      expect(order).toEqual(['exec:a', 'exec:b', 'exec:c']);
      expect(ctx).toMatchObject({ a: true, b: true, c: true });
      expect(saga.status).toBe(SagaStatus.COMPLETED);
    });

    it('merges step context patches into running context', async () => {
      const steps: SagaStep<Ctx>[] = [
        makeStep('step_x', async () => ({ tradeId: 'trade-99' })),
        makeStep('step_y', async (ctx) => {
          expect(ctx['tradeId']).toBe('trade-99');
          return { txHash: 'hash-abc' };
        }),
      ];

      const saga = mockSaga();
      const ctx = await orchestrator.run(saga, steps, {});
      expect(ctx['tradeId']).toBe('trade-99');
      expect(ctx['txHash']).toBe('hash-abc');
    });
  });

  describe('run – failure and compensation', () => {
    it('compensates completed steps in reverse order when a step fails', async () => {
      const order: string[] = [];

      const steps: SagaStep<Ctx>[] = [
        makeStep(
          'step_a',
          async () => { order.push('exec:a'); return {}; },
          async () => { order.push('comp:a'); },
        ),
        makeStep(
          'step_b',
          async () => { order.push('exec:b'); return {}; },
          async () => { order.push('comp:b'); },
        ),
        makeStep(
          'step_c',
          async () => { order.push('exec:c'); throw new Error('step_c exploded'); },
          async () => { order.push('comp:c'); },
        ),
      ];

      const saga = mockSaga();
      await expect(orchestrator.run(saga, steps, {})).rejects.toThrow('step_c exploded');

      expect(order).toEqual(['exec:a', 'exec:b', 'exec:c', 'comp:b', 'comp:a']);
      expect(saga.status).toBe(SagaStatus.COMPENSATED);
    });

    it('simulates failure at step 1 (first step) — no compensations run', async () => {
      const compensated: string[] = [];

      const steps: SagaStep<Ctx>[] = [
        makeStep(
          'step_a',
          async () => { throw new Error('first step fails'); },
          async () => { compensated.push('comp:a'); },
        ),
        makeStep('step_b', async () => ({}), async () => { compensated.push('comp:b'); }),
      ];

      const saga = mockSaga();
      await expect(orchestrator.run(saga, steps, {})).rejects.toThrow('first step fails');

      // No steps were completed before the failure so nothing to compensate
      expect(compensated).toEqual([]);
      expect(saga.status).toBe(SagaStatus.COMPENSATED);
    });

    it('simulates failure at each step position and verifies correct compensation', async () => {
      const STEP_COUNT = 4;

      for (let failAt = 0; failAt < STEP_COUNT; failAt++) {
        const execOrder: number[] = [];
        const compOrder: number[] = [];

        const steps: SagaStep<Ctx>[] = Array.from({ length: STEP_COUNT }, (_, i) =>
          makeStep(
            `step_${i}`,
            async () => {
              execOrder.push(i);
              if (i === failAt) throw new Error(`step ${i} failed`);
              return {};
            },
            async () => { compOrder.push(i); },
          ),
        );

        const saga = mockSaga();
        await expect(orchestrator.run(saga, steps, {})).rejects.toThrow();

        // Steps 0..failAt-1 completed and should be compensated in reverse
        const expectedExec = Array.from({ length: failAt + 1 }, (_, i) => i);
        const expectedComp = Array.from({ length: failAt }, (_, i) => failAt - 1 - i);

        expect(execOrder).toEqual(expectedExec);
        expect(compOrder).toEqual(expectedComp);
        expect(saga.status).toBe(SagaStatus.COMPENSATED);
      }
    });

    it('marks saga FAILED_TO_COMPENSATE when a compensation itself throws', async () => {
      const steps: SagaStep<Ctx>[] = [
        makeStep(
          'step_a',
          async () => ({}),
          async () => { throw new Error('compensation also failed'); },
        ),
        makeStep(
          'step_b',
          async () => { throw new Error('main failure'); },
          async () => {},
        ),
      ];

      const saga = mockSaga();
      await expect(orchestrator.run(saga, steps, {})).rejects.toThrow('main failure');

      expect(saga.status).toBe(SagaStatus.FAILED_TO_COMPENSATE);
      expect(saga.outcomeMessage).toContain('compensation also failed');
    });
  });

  describe('step persistence', () => {
    it('persists COMPLETED step record after each successful step', async () => {
      const steps: SagaStep<Ctx>[] = [
        makeStep('reserve_funds', async () => ({ fundsReserved: true })),
        makeStep('persist_trade', async () => ({ tradeId: 'trade-42' })),
      ];

      const saga = mockSaga();
      await orchestrator.run(saga, steps, {});

      const completedNames = saga.steps
        .filter((s) => s.status === SagaStepStatus.COMPLETED)
        .map((s) => s.step);

      expect(completedNames).toEqual(['reserve_funds', 'persist_trade']);
    });

    it('records tradeId on saga entity when step returns it', async () => {
      const steps: SagaStep<Ctx>[] = [
        makeStep('persist_trade', async () => ({ tradeId: 'trade-999' })),
      ];

      const saga = mockSaga();
      await orchestrator.run(saga, steps, {});

      expect(saga.tradeId).toBe('trade-999');
    });
  });

  describe('createSaga', () => {
    it('creates and persists a saga with RUNNING status', async () => {
      sagaRepo.create.mockReturnValue({
        userId: 'u1',
        traceId: 'tr1',
        status: SagaStatus.RUNNING,
        steps: [],
      } as unknown as TradeSagaEntity);

      const saga = await orchestrator.createSaga('u1', 'tr1', { foo: 'bar' });
      expect(sagaRepo.save).toHaveBeenCalled();
      expect(saga.status).toBe(SagaStatus.RUNNING);
    });
  });
});
