import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EtlOrchestratorService } from './etl-orchestrator.service';
import { UserEventsExtractor } from './extractors/user-events.extractor';
import { TradesExtractor } from './extractors/trades.extractor';
import { SignalsExtractor } from './extractors/signals.extractor';
import { ParquetTransformer } from './transformers/parquet.transformer';
import { DataLakeLoader } from './loaders/data-lake.loader';
import { EtlJob, EtlJobStatus, EtlJobType } from '../entities/etl-job.entity';

describe('EtlOrchestratorService', () => {
  let service: EtlOrchestratorService;
  let etlJobRepository: jest.Mocked<Repository<EtlJob>>;
  let userEventsExtractor: jest.Mocked<UserEventsExtractor>;
  let tradesExtractor: jest.Mocked<TradesExtractor>;
  let signalsExtractor: jest.Mocked<SignalsExtractor>;
  let parquetTransformer: jest.Mocked<ParquetTransformer>;
  let dataLakeLoader: jest.Mocked<DataLakeLoader>;

  const mockJob: EtlJob = {
    id: 'job-123',
    jobType: EtlJobType.USER_EVENTS,
    status: EtlJobStatus.RUNNING,
    startDate: new Date('2024-03-15T00:00:00Z'),
    endDate: new Date('2024-03-15T23:59:59Z'),
    recordsProcessed: 0,
    partitionPath: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockExtractedRecords = [
    {
      id: 'evt-1',
      timestamp: new Date('2024-03-15T10:00:00Z'),
      source: 'user_events',
      data: { userId: 'u1', eventType: 'SWIPE_RIGHT' },
    },
  ];

  const mockParquetRecord = {
    schema: { name: 'user_events', fields: [] },
    partitionKey: 'user_events/year=2024/month=03/day=15',
    data: [{ _id: 'evt-1' }],
    recordCount: 1,
    sizeBytes: 100,
    format: 'PARQUET' as const,
    compression: 'SNAPPY' as const,
  };

  const mockLoadResult = {
    partitionKey: 'user_events/year=2024/month=03/day=15',
    filePath: '/tmp/data-lake/user_events/year=2024/month=03/day=15/data.parquet.json',
    recordCount: 1,
    sizeBytes: 100,
    writtenAt: new Date(),
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    const mockUserEventsExtractor = {
      sourceName: 'user_events',
      extract: jest.fn(),
    };

    const mockTradesExtractor = {
      sourceName: 'trades',
      extract: jest.fn(),
    };

    const mockSignalsExtractor = {
      sourceName: 'signals',
      extract: jest.fn(),
    };

    const mockParquetTransformer = {
      transform: jest.fn(),
      buildPartitionKey: jest.fn(),
    };

    const mockDataLakeLoader = {
      load: jest.fn(),
      applyRetentionPolicy: jest.fn(),
      getPartitionPath: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EtlOrchestratorService,
        { provide: getRepositoryToken(EtlJob), useValue: mockRepository },
        { provide: UserEventsExtractor, useValue: mockUserEventsExtractor },
        { provide: TradesExtractor, useValue: mockTradesExtractor },
        { provide: SignalsExtractor, useValue: mockSignalsExtractor },
        { provide: ParquetTransformer, useValue: mockParquetTransformer },
        { provide: DataLakeLoader, useValue: mockDataLakeLoader },
      ],
    }).compile();

    service = module.get<EtlOrchestratorService>(EtlOrchestratorService);
    etlJobRepository = module.get(getRepositoryToken(EtlJob));
    userEventsExtractor = module.get(UserEventsExtractor);
    tradesExtractor = module.get(TradesExtractor);
    signalsExtractor = module.get(SignalsExtractor);
    parquetTransformer = module.get(ParquetTransformer);
    dataLakeLoader = module.get(DataLakeLoader);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runEtlPipeline', () => {
    const startDate = new Date('2024-03-15T00:00:00Z');
    const endDate = new Date('2024-03-15T23:59:59Z');

    beforeEach(() => {
      etlJobRepository.create.mockReturnValue({ ...mockJob });
      etlJobRepository.save.mockResolvedValue({ ...mockJob });
      userEventsExtractor.extract.mockResolvedValue(mockExtractedRecords);
      parquetTransformer.transform.mockReturnValue(mockParquetRecord);
      dataLakeLoader.load.mockResolvedValue(mockLoadResult);
    });

    it('should run a successful USER_EVENTS pipeline', async () => {
      const result = await service.runEtlPipeline(
        EtlJobType.USER_EVENTS,
        startDate,
        endDate,
      );

      expect(result.jobType).toBe(EtlJobType.USER_EVENTS);
      expect(result.status).toBe(EtlJobStatus.COMPLETED);
      expect(result.recordsProcessed).toBe(1);
      expect(result.partitionPath).toBe(
        'user_events/year=2024/month=03/day=15',
      );
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should run a successful TRADES pipeline', async () => {
      tradesExtractor.extract.mockResolvedValue(mockExtractedRecords);

      const result = await service.runEtlPipeline(
        EtlJobType.TRADES,
        startDate,
        endDate,
      );

      expect(result.jobType).toBe(EtlJobType.TRADES);
      expect(result.status).toBe(EtlJobStatus.COMPLETED);
      expect(tradesExtractor.extract).toHaveBeenCalledWith({
        startDate,
        endDate,
        batchSize: 10000,
      });
    });

    it('should run a successful SIGNALS pipeline', async () => {
      signalsExtractor.extract.mockResolvedValue(mockExtractedRecords);

      const result = await service.runEtlPipeline(
        EtlJobType.SIGNALS,
        startDate,
        endDate,
      );

      expect(result.jobType).toBe(EtlJobType.SIGNALS);
      expect(result.status).toBe(EtlJobStatus.COMPLETED);
    });

    it('should create job with RUNNING status initially', async () => {
      await service.runEtlPipeline(EtlJobType.USER_EVENTS, startDate, endDate);

      expect(etlJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: EtlJobStatus.RUNNING }),
      );
    });

    it('should save job with COMPLETED status on success', async () => {
      await service.runEtlPipeline(EtlJobType.USER_EVENTS, startDate, endDate);

      const secondSaveCall = etlJobRepository.save.mock.calls[1][0];
      expect(secondSaveCall.status).toBe(EtlJobStatus.COMPLETED);
      expect(secondSaveCall.recordsProcessed).toBe(1);
    });

    it('should throw NotFoundException when job type has no extractor', async () => {
      await expect(
        service.runEtlPipeline('UNKNOWN_TYPE' as EtlJobType, startDate, endDate),
      ).rejects.toThrow(NotFoundException);

      const failSaveCall = etlJobRepository.save.mock.calls[1][0];
      expect(failSaveCall.status).toBe(EtlJobStatus.FAILED);
    });

    it('should save job with FAILED status and rethrow on error', async () => {
      const error = new Error('DB connection failed');
      userEventsExtractor.extract.mockRejectedValue(error);

      await expect(
        service.runEtlPipeline(EtlJobType.USER_EVENTS, startDate, endDate),
      ).rejects.toThrow('DB connection failed');

      const failSaveCall = etlJobRepository.save.mock.calls[1][0];
      expect(failSaveCall.status).toBe(EtlJobStatus.FAILED);
      expect(failSaveCall.errorMessage).toBe('DB connection failed');
    });

    it('should call parquetTransformer.transform with correct args', async () => {
      await service.runEtlPipeline(EtlJobType.USER_EVENTS, startDate, endDate);

      expect(parquetTransformer.transform).toHaveBeenCalledWith(
        'user_events',
        mockExtractedRecords,
        startDate,
      );
    });

    it('should call dataLakeLoader.load with parquet record', async () => {
      await service.runEtlPipeline(EtlJobType.USER_EVENTS, startDate, endDate);

      expect(dataLakeLoader.load).toHaveBeenCalledWith(mockParquetRecord);
    });
  });

  describe('runDailyEtl', () => {
    it('should run ETL for all three job types and then retention cleanup', async () => {
      const pipelineResult = {
        jobId: 'job-1',
        jobType: EtlJobType.USER_EVENTS,
        status: EtlJobStatus.COMPLETED,
        recordsProcessed: 5,
        partitionPath: 'user_events/year=2024/month=03/day=14',
        durationMs: 100,
      };

      jest.spyOn(service, 'runEtlPipeline').mockResolvedValue(pipelineResult);
      jest
        .spyOn(service, 'runRetentionCleanup')
        .mockResolvedValue({ user_events: 0, trades: 0, signals: 0 });

      await service.runDailyEtl();

      expect(service.runEtlPipeline).toHaveBeenCalledTimes(3);
      expect(service.runEtlPipeline).toHaveBeenCalledWith(
        EtlJobType.USER_EVENTS,
        expect.any(Date),
        expect.any(Date),
      );
      expect(service.runEtlPipeline).toHaveBeenCalledWith(
        EtlJobType.TRADES,
        expect.any(Date),
        expect.any(Date),
      );
      expect(service.runEtlPipeline).toHaveBeenCalledWith(
        EtlJobType.SIGNALS,
        expect.any(Date),
        expect.any(Date),
      );
      expect(service.runRetentionCleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('runRetentionCleanup', () => {
    it('should apply retention policy for all sources and return results', async () => {
      dataLakeLoader.applyRetentionPolicy.mockResolvedValueOnce(2);
      dataLakeLoader.applyRetentionPolicy.mockResolvedValueOnce(0);
      dataLakeLoader.applyRetentionPolicy.mockResolvedValueOnce(1);

      const results = await service.runRetentionCleanup();

      expect(results['user_events']).toBe(2);
      expect(results['trades']).toBe(0);
      expect(results['signals']).toBe(1);
      expect(dataLakeLoader.applyRetentionPolicy).toHaveBeenCalledTimes(3);
      expect(dataLakeLoader.applyRetentionPolicy).toHaveBeenCalledWith({
        sourceName: 'user_events',
        retentionDays: 365,
      });
      expect(dataLakeLoader.applyRetentionPolicy).toHaveBeenCalledWith({
        sourceName: 'trades',
        retentionDays: 730,
      });
      expect(dataLakeLoader.applyRetentionPolicy).toHaveBeenCalledWith({
        sourceName: 'signals',
        retentionDays: 365,
      });
    });
  });

  describe('getJobHistory', () => {
    it('should return jobs ordered by createdAt DESC with default limit 50', async () => {
      const jobs = [mockJob];
      etlJobRepository.find.mockResolvedValue(jobs);

      const result = await service.getJobHistory();

      expect(result).toEqual(jobs);
      expect(etlJobRepository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 50,
      });
    });

    it('should use provided limit', async () => {
      etlJobRepository.find.mockResolvedValue([]);
      await service.getJobHistory(10);

      expect(etlJobRepository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 10,
      });
    });
  });

  describe('getJobById', () => {
    it('should return job when found', async () => {
      etlJobRepository.findOne.mockResolvedValue(mockJob);

      const result = await service.getJobById('job-123');

      expect(result).toEqual(mockJob);
      expect(etlJobRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'job-123' },
      });
    });

    it('should throw NotFoundException when job not found', async () => {
      etlJobRepository.findOne.mockResolvedValue(null);

      await expect(service.getJobById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
