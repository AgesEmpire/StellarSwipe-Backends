import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ContractDeploymentService } from './contract-deployment.service';
import { StellarConfigService } from '../../config/stellar.service';
import { SorobanException } from '../../common/exceptions';

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => mockRpcServer),
      Api: { isSimulationError: jest.fn().mockReturnValue(false) },
    },
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: () => 'GABC',
        sign: jest.fn(),
      }),
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ sign: jest.fn() }),
    })),
    Operation: { uploadContractWasm: jest.fn().mockReturnValue({}) },
    BASE_FEE: '100',
  };
});

const mockRpcServer = {
  getAccount: jest.fn(),
  simulateTransaction: jest.fn(),
  prepareTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  getTransaction: jest.fn(),
};

const mockStellarConfig = {
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  apiTimeout: 10000,
  maxRetries: 2,
};

describe('ContractDeploymentService', () => {
  let service: ContractDeploymentService;

  const baseOptions = {
    wasmHash: 'deadbeef',
    sourceSecret: 'SCZANGBA5YELHNLJUYZ3G5BSHE2ZVUHDQKWQ5OZVBQ5AQAMELZQHQOS',
    idempotencyKey: 'deploy-test-1',
    maxRetries: 2,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractDeploymentService,
        { provide: StellarConfigService, useValue: mockStellarConfig },
      ],
    }).compile();

    service = module.get(ContractDeploymentService);
  });

  function setupSuccessfulDeploy() {
    mockRpcServer.getAccount.mockResolvedValue({ accountId: 'GABC', sequence: '1' });
    mockRpcServer.simulateTransaction.mockResolvedValue({ minResourceFee: '100' });
    mockRpcServer.prepareTransaction.mockResolvedValue({ sign: jest.fn() });
    mockRpcServer.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'txhash123' });
    mockRpcServer.getTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'txhash123' });
  }

  it('deploys successfully on first attempt', async () => {
    setupSuccessfulDeploy();
    jest.useFakeTimers();

    const promise = service.deployContract(baseOptions);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(1);
    jest.useRealTimers();
  });

  it('retries on transient RPC failure and succeeds', async () => {
    mockRpcServer.getAccount.mockResolvedValue({ accountId: 'GABC', sequence: '1' });
    mockRpcServer.simulateTransaction.mockResolvedValue({ minResourceFee: '100' });
    mockRpcServer.prepareTransaction.mockResolvedValue({ sign: jest.fn() });
    mockRpcServer.sendTransaction
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue({ status: 'PENDING', hash: 'txhash123' });
    mockRpcServer.getTransaction.mockResolvedValue({ status: 'SUCCESS', hash: 'txhash123' });

    jest.useFakeTimers();
    const promise = service.deployContract(baseOptions);
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(2);
    jest.useRealTimers();
  });

  it('fails after exhausting all retries', async () => {
    mockRpcServer.getAccount.mockRejectedValue(new Error('RPC unavailable'));

    jest.useFakeTimers();
    const promise = service.deployContract({ ...baseOptions, idempotencyKey: 'deploy-fail' });
    await jest.runAllTimersAsync();

    await expect(promise).rejects.toBeInstanceOf(SorobanException);
    jest.useRealTimers();
  });

  it('logs failure details for each retry attempt', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn');
    mockRpcServer.getAccount.mockRejectedValue(new Error('transient'));

    jest.useFakeTimers();
    const promise = service.deployContract({ ...baseOptions, idempotencyKey: 'deploy-log' });
    await jest.runAllTimersAsync();
    await promise.catch(() => {});

    expect(warnSpy).toHaveBeenCalledTimes(3); // maxRetries=2 → 3 attempts
    jest.useRealTimers();
  });

  it('rejects duplicate deployment via idempotency check', async () => {
    setupSuccessfulDeploy();
    jest.useFakeTimers();

    const key = 'deploy-idempotent';
    const first = service.deployContract({ ...baseOptions, idempotencyKey: key });
    await jest.runAllTimersAsync();
    await first;

    await expect(
      service.deployContract({ ...baseOptions, idempotencyKey: key }),
    ).rejects.toBeInstanceOf(ConflictException);
    jest.useRealTimers();
  });

  it('returns deployment status after retries', async () => {
    mockRpcServer.getAccount.mockRejectedValue(new Error('down'));

    jest.useFakeTimers();
    const key = 'deploy-status';
    const promise = service.deployContract({ ...baseOptions, idempotencyKey: key });
    await jest.runAllTimersAsync();
    await promise.catch(() => {});

    const status = service.getDeploymentStatus(key);
    expect(status?.status).toBe('failed');
    expect(status?.attempts).toBeGreaterThan(0);
    expect(status?.lastError).toBeDefined();
    jest.useRealTimers();
  });
});
