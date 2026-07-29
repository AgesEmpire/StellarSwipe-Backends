import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { ZapierService } from './zapier.service';
import { TriggerEvent } from './dto/trigger-config.dto';

describe('ZapierService', () => {
  let service: ZapierService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZapierService,
        {
          provide: HttpService,
          useValue: { post: jest.fn().mockReturnValue(of({ data: {} })) },
        },
      ],
    }).compile();

    service = module.get(ZapierService);
    httpService = module.get(HttpService);
  });

  it('should subscribe and dispatch to hook', async () => {
    service.subscribe('user1', { event: TriggerEvent.NEW_SIGNAL, hookUrl: 'https://hooks.zapier.com/test' });
    await service.dispatch('user1', TriggerEvent.NEW_SIGNAL, { signalId: 'sig_1' });
    expect(httpService.post).toHaveBeenCalledWith(
      'https://hooks.zapier.com/test',
      expect.objectContaining({ event: TriggerEvent.NEW_SIGNAL }),
    );
  });

  it('should unsubscribe hook', async () => {
    service.subscribe('user1', { event: TriggerEvent.NEW_SIGNAL, hookUrl: 'https://hooks.zapier.com/test' });
    service.unsubscribe('user1', TriggerEvent.NEW_SIGNAL, 'https://hooks.zapier.com/test');
    await service.dispatch('user1', TriggerEvent.NEW_SIGNAL, {});
    expect(httpService.post).not.toHaveBeenCalled();
  });
});
