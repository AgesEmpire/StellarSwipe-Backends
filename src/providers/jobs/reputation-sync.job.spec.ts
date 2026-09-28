import { ReputationSyncJob } from './reputation-sync.job';

const provider = (overrides: Record<string, unknown> = {}) => ({
  providerId: 'provider-1',
  reputationScore: '50',
  ...overrides,
});

describe('ReputationSyncJob', () => {
  let repository: { find: jest.Mock; update: jest.Mock };
  let sorobanService: { invokeContract: jest.Mock };
  let configService: { get: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let monitoringService: { recordFailure: jest.Mock };
  let job: ReputationSyncJob;

  beforeEach(() => {
    repository = {
      find: jest.fn().mockResolvedValue([provider()]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    sorobanService = { invokeContract: jest.fn().mockResolvedValue({ result: '50' }) };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'SIGNAL_REGISTRY_CONTRACT_ID') return 'signal-registry-contract';
        if (key === 'SIGNAL_REGISTRY_SOURCE_SECRET') return 'source-secret';
        return undefined;
      }),
    };
    eventEmitter = { emit: jest.fn() };
    monitoringService = { recordFailure: jest.fn() };
    job = new ReputationSyncJob(
      repository as any,
      sorobanService as any,
      configService as any,
      eventEmitter as any,
      monitoringService as any,
    );
  });

  it('does not emit an event when the score is unchanged', async () => {
    await job.syncProviderReputations();

    expect(repository.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('updates the local score and emits ProviderReputationSynced when score changes', async () => {
    sorobanService.invokeContract.mockResolvedValue({ result: '72' });

    await job.syncProviderReputations();

    expect(repository.update).toHaveBeenCalledWith('provider-1', { reputationScore: '72' });
    expect(eventEmitter.emit).toHaveBeenCalledWith('provider.reputation.synced', {
      providerId: 'provider-1',
      oldScore: '50',
      newScore: '72',
    });
  });

  it('alerts monitoring after three consecutive provider sync failures', async () => {
    sorobanService.invokeContract.mockRejectedValue(new Error('rpc unavailable'));

    await job.syncProviderReputations();
    await job.syncProviderReputations();
    await job.syncProviderReputations();

    expect(monitoringService.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'signal-registry-contract',
        method: 'get_provider_reputation',
        error: 'rpc unavailable',
        userId: 'provider-1',
      }),
    );
  });

  it('processes providers in batches of ten', async () => {
    jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
      callback();
      return 0 as any;
    });
    repository.find.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) =>
        provider({ providerId: `provider-${index}`, reputationScore: '50' }),
      ),
    );

    await job.syncProviderReputations();

    expect(sorobanService.invokeContract).toHaveBeenCalledTimes(11);
    jest.restoreAllMocks();
  });
});