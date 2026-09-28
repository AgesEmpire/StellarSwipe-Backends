import { Test, TestingModule } from '@nestjs/testing';
import { SorobanSimulationService } from './soroban-simulation.service';
import { StellarConfigService } from '../config/stellar.service';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { SorobanException } from '../common/exceptions';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSimulateTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulateTransaction,
      })),
    },
  };
});

const mockStellarConfig = (): Partial<StellarConfigService> => ({
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
  networkPassphrase: 'Test SDF Network ; September 2015',
  apiTimeout: 5000,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function successSimulation(overrides: Record<string, unknown> = {}): SorobanRpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: '1',
    latestLedger: 100,
    minResourceFee: '50000',
    result: {
      retval: undefined,
      auth: [],
    },
    transactionData: '',
    events: [],
    cost: { cpuInsns: '100', memBytes: '200' },
    ...overrides,
  } as unknown as SorobanRpc.Api.SimulateTransactionSuccessResponse;
}

function errorSimulation(errorMsg: string): SorobanRpc.Api.SimulateTransactionErrorResponse {
  return {
    id: '1',
    latestLedger: 100,
    error: errorMsg,
    events: [],
  } as unknown as SorobanRpc.Api.SimulateTransactionErrorResponse;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SorobanSimulationService', () => {
  let service: SorobanSimulationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanSimulationService,
        { provide: StellarConfigService, useValue: mockStellarConfig() },
      ],
    }).compile();

    service = module.get(SorobanSimulationService);
  });

  // ── Successful simulation ────────────────────────────────────────────────

  describe('successful simulation', () => {
    it('returns success=true with fee estimates', async () => {
      mockSimulateTransaction.mockResolvedValue(successSimulation({ minResourceFee: '75000' }));

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'balance',
        params: ['GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'],
      });

      expect(result.success).toBe(true);
      expect(result.resourceFee).toBe('75000');
      expect(result.minResourceFee).toBe('75000');
      expect(result.totalFee).toBeDefined();
      // totalFee = resourceFee + inclusionFee (BASE_FEE = 100 stroops)
      expect(BigInt(result.totalFee!)).toBeGreaterThan(BigInt('75000'));
    });

    it('includes result value when contract returns a value', async () => {
      mockSimulateTransaction.mockResolvedValue(
        successSimulation({
          result: { retval: undefined, auth: [] },
        }),
      );

      const response = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'get_balance',
      });

      expect(response.success).toBe(true);
    });

    it('uses neutral simulation account when no sourceAccount/sourceSecret provided', async () => {
      mockSimulateTransaction.mockResolvedValue(successSimulation());

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'ping',
      });

      expect(result.success).toBe(true);
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    });

    it('derives source key from sourceSecret when provided', async () => {
      mockSimulateTransaction.mockResolvedValue(successSimulation());

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'ping',
        sourceSecret: 'SBVESQ4O3X4RQFMPG2NGXHWAQXJQSAFUYQ625YCJK4L4AFQF45RWB3G',
      });

      expect(result.success).toBe(true);
    });
  });

  // ── Simulation indicating contract would fail ─────────────────────────────

  describe('simulation with contract revert', () => {
    it('returns success=false with simulationError when contract would revert', async () => {
      mockSimulateTransaction.mockResolvedValue(
        errorSimulation('HostError: Contract error: Arithmetic(DivisionByZero)'),
      );

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'divide',
        params: [10, 0],
      });

      expect(result.success).toBe(false);
      expect(result.simulationError).toContain('DivisionByZero');
      expect(result.rpcError).toBeUndefined();
    });

    it('surfaces contract revert distinct from rpcError', async () => {
      mockSimulateTransaction.mockResolvedValue(
        errorSimulation('HostError: Contract error: value_missing'),
      );

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'get_missing_key',
      });

      expect(result.simulationError).toBeDefined();
      expect(result.rpcError).toBeUndefined();
    });
  });

  // ── RPC connectivity errors ──────────────────────────────────────────────

  describe('RPC connectivity errors', () => {
    it('returns success=false with rpcError when server is unreachable', async () => {
      mockSimulateTransaction.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:8000'),
      );

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'balance',
      });

      expect(result.success).toBe(false);
      expect(result.rpcError).toContain('RPC simulateTransaction failed');
      expect(result.simulationError).toBeUndefined();
    });

    it('distinguishes rpcError from simulationError', async () => {
      mockSimulateTransaction.mockRejectedValue(
        new SorobanException('Network timeout'),
      );

      const result = await service.simulate({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        method: 'balance',
      });

      expect(result.success).toBe(false);
      expect(result.rpcError).toContain('Network timeout');
      expect(result.simulationError).toBeUndefined();
    });
  });
});
