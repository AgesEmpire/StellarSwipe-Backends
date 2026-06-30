import { Test, TestingModule } from '@nestjs/testing';
import { ClientProxy, ClientsModule, Transport } from '@nestjs/microservices';
import { INestApplication, INestMicroservice } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { NotificationTcpController } from './notification-tcp.controller';
import { PreferencesService } from './preferences/preferences.service';
import { TCP_PATTERNS } from './dto/tcp-notification.dto';

const TCP_TEST_PORT = 3099;

describe('NotificationTcpController (integration)', () => {
  let app: INestApplication;
  let microservice: INestMicroservice;
  let client: ClientProxy;

  const mockPreferencesService: Partial<PreferencesService> = {
    getPreferences: jest.fn().mockResolvedValue({
      userId: 'user-1',
      tradeUpdates: { email: true, push: true },
      signalPerformance: { email: true, push: false },
      systemAlerts: { email: true, push: true },
      marketing: { email: false, push: false },
      updatedAt: new Date('2024-01-01'),
    }),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ClientsModule.register([
          { name: 'TEST_CLIENT', transport: Transport.TCP, options: { port: TCP_TEST_PORT } },
        ]),
      ],
      controllers: [NotificationTcpController],
      providers: [{ provide: PreferencesService, useValue: mockPreferencesService }],
    }).compile();

    microservice = moduleRef.createNestMicroservice({
      transport: Transport.TCP,
      options: { host: '0.0.0.0', port: TCP_TEST_PORT },
    });
    await microservice.listen();

    app = moduleRef.createNestApplication();
    await app.init();

    client = moduleRef.get<ClientProxy>('TEST_CLIENT');
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await microservice.close();
    await app.close();
  });

  it('returns user preferences over TCP', async () => {
    const result = await firstValueFrom(
      client.send(TCP_PATTERNS.GET_USER_PREFERENCES, { userId: 'user-1' }),
    );

    expect(result).toMatchObject({
      userId: 'user-1',
      marketing: { email: false, push: false },
    });
    expect(mockPreferencesService.getPreferences).toHaveBeenCalledWith('user-1');
  });

  it('forwards the payload userId to PreferencesService', async () => {
    await firstValueFrom(
      client.send(TCP_PATTERNS.GET_USER_PREFERENCES, { userId: 'user-42' }),
    );
    expect(mockPreferencesService.getPreferences).toHaveBeenCalledWith('user-42');
  });
});
