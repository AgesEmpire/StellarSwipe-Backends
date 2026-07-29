import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { ValidateFeatureFlagEntrypointsJob } from './validate-feature-flag-entrypoints.job';

describe('ValidateFeatureFlagEntrypointsJob', () => {
  let job: ValidateFeatureFlagEntrypointsJob;
  let mockFlagRepository: any;

  beforeEach(async () => {
    mockFlagRepository = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateFeatureFlagEntrypointsJob,
        {
          provide: getRepositoryToken(FeatureFlag),
          useValue: mockFlagRepository,
        },
      ],
    }).compile();

    job = module.get<ValidateFeatureFlagEntrypointsJob>(ValidateFeatureFlagEntrypointsJob);
    jest.spyOn((job as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  it('should detect flags with nonexistent entrypoints', async () => {
    mockFlagRepository.find.mockResolvedValue([
      {
        name: 'stale_entrypoint_test_fixture',
        contractId: 'TradeExecutorContract',
        method: 'nonexistent_entrypoint',
        retired: false,
      } as FeatureFlag,
    ]);

    await job.run();

    expect((job as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('references an invalid target'),
    );
    expect((job as any).logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Detected 1 feature flag(s) with missing entrypoints'),
    );
    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('valid: 0'),
    );
  });

  it('should skip retired flags', async () => {
    mockFlagRepository.find.mockResolvedValue([
      {
        name: 'old_deprecated_flag',
        contractId: 'TradeExecutorContract',
        method: 'nonexistent_entrypoint',
        retired: true,
      } as FeatureFlag,
    ]);

    await job.run();

    expect((job as any).logger.warn).not.toHaveBeenCalled();
    expect((job as any).logger.error).not.toHaveBeenCalled();
    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('retired: 1'),
    );
  });

  it('should validate flags with known entrypoints', async () => {
    mockFlagRepository.find.mockResolvedValue([
      {
        name: 'valid_trade_flag',
        contractId: 'TradeExecutorContract',
        method: 'execute_market_order',
        retired: false,
      } as FeatureFlag,
    ]);

    await job.run();

    expect((job as any).logger.warn).not.toHaveBeenCalled();
    expect((job as any).logger.error).not.toHaveBeenCalled();
    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('valid: 1'),
    );
  });

  it('should handle unknown contracts gracefully', async () => {
    mockFlagRepository.find.mockResolvedValue([
      {
        name: 'unknown_contract_flag',
        contractId: 'UnknownContract',
        method: 'some_method',
        retired: false,
      } as FeatureFlag,
    ]);

    await job.run();

    expect((job as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not in the entrypoint registry'),
    );
    expect((job as any).logger.error).toHaveBeenCalled();
    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('valid: 0'),
    );
  });

  it('should handle empty flag set', async () => {
    mockFlagRepository.find.mockResolvedValue([]);

    await job.run();

    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('No contract-scoped feature flags found'),
    );
  });
});
