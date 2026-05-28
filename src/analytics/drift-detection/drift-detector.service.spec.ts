import {
  DriftAlertPublisher,
  DriftDetectorService,
  DriftFindingStore,
} from './drift-detector.service';
import { DetectDataDriftJob } from './jobs/detect-data-drift.job';
import { compareDistributions } from './utils/distribution-analyzer';

describe('DriftDetectorService', () => {
  let findingStore: jest.Mocked<DriftFindingStore>;
  let alertPublisher: jest.Mocked<DriftAlertPublisher>;
  let service: DriftDetectorService;

  beforeEach(() => {
    findingStore = {
      saveDriftFinding: jest.fn(),
    };
    alertPublisher = {
      publishDriftAlert: jest.fn(),
    };
    service = new DriftDetectorService(findingStore, alertPublisher);
  });

  it('compares distributions and reports no drift below the configured threshold', async () => {
    const findings = await service.detectFeedDrift({
      feedName: 'stellar-price-feed',
      threshold: 0.25,
      baseline: {
        price: [100, 101, 99, 100],
      },
      current: {
        price: [102, 101, 100, 102],
      },
    });

    expect(findings).toEqual([]);
    expect(findingStore.saveDriftFinding).not.toHaveBeenCalled();
    expect(alertPublisher.publishDriftAlert).not.toHaveBeenCalled();
  });

  it('stores drift findings and publishes alerts when thresholds are exceeded', async () => {
    const findings = await service.detectFeedDrift({
      feedName: 'stellar-price-feed',
      threshold: 0.2,
      baseline: {
        price: [100, 101, 99, 100],
        volume: [1_000, 1_050, 950, 1_000],
      },
      current: {
        price: [150, 151, 149, 152],
        volume: [1_020, 1_070, 970, 1_020],
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      feedName: 'stellar-price-feed',
      metric: 'price',
      severity: 'critical',
    });
    expect(findingStore.saveDriftFinding).toHaveBeenCalledWith(findings[0]);
    expect(alertPublisher.publishDriftAlert).toHaveBeenCalledWith(findings[0]);
  });

  it('runs the scheduled job against configured feed snapshots', async () => {
    const feedProvider = {
      getDriftSnapshots: jest.fn().mockResolvedValue([
        {
          feedName: 'trade-signal-feed',
          threshold: 0.1,
          baseline: { confidence: [70, 72, 71] },
          current: { confidence: [40, 41, 39] },
        },
      ]),
    };
    const job = new DetectDataDriftJob(service, feedProvider);

    const findings = await job.run();

    expect(feedProvider.getDriftSnapshots).toHaveBeenCalled();
    expect(findings).toHaveLength(1);
    expect(alertPublisher.publishDriftAlert).toHaveBeenCalledTimes(1);
  });

  it('calculates stable distribution summaries for review', () => {
    const comparison = compareDistributions(
      'latency',
      [10, 12, 14, 16],
      [20, 22, 24, 26],
      0.25,
    );

    expect(comparison.baseline.mean).toBe(13);
    expect(comparison.current.mean).toBe(23);
    expect(comparison.drifted).toBe(true);
  });
});
