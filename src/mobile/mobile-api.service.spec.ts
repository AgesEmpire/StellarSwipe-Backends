import { Test, TestingModule } from '@nestjs/testing';
import { MobileApiService } from './mobile-api.service';
import { PayloadOptimizerService } from './services/payload-optimizer.service';
import { DeltaSyncService } from './services/delta-sync.service';
import { PushTokenManagerService } from './services/push-token-manager.service';

describe('MobileApiService', () => {
  let service: MobileApiService;
  let pushTokenManager: PushTokenManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MobileApiService,
        PayloadOptimizerService,
        DeltaSyncService,
        PushTokenManagerService,
      ],
    }).compile();

    service = module.get<MobileApiService>(MobileApiService);
    pushTokenManager = module.get<PushTokenManagerService>(PushTokenManagerService);
  });

  it('should return empty delta for empty feed', () => {
    const result = service.getFeed(undefined);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.deletedIds).toEqual([]);
    expect(result.nextSyncToken).toBeDefined();
  });

  it('should return compact portfolio', () => {
    const result = service.getPortfolio('user-1');
    expect(result).toHaveProperty('bal');
    expect(result).toHaveProperty('ts');
  });

  it('should process batch requests', async () => {
    const result = await service.processBatch({
      requests: [{ id: 'r1', path: '/mobile/feed' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
    expect(result[0].status).toBe(200);
  });

  it('should register and retrieve push token', () => {
    service.registerPushToken('user-1', 'tok-abc', 'ios');
    const tokens = pushTokenManager.getTokensForUser('user-1');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].platform).toBe('ios');
  });

  it('should deregister push token', () => {
    service.registerPushToken('user-1', 'tok-xyz', 'android');
    service.deregisterPushToken('tok-xyz');
    expect(pushTokenManager.getTokensForUser('user-1')).toHaveLength(0);
  });
});
