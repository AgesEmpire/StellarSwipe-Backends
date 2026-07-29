import { Test, TestingModule } from '@nestjs/testing';
import { SecretRotationScheduler } from './rotation-scheduler.service';
import { SecretsLoaderService } from './secrets-loader.service';
import { RotationService } from './rotation.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

describe('SecretRotationScheduler', () => {
  let scheduler: SecretRotationScheduler;
  let rotationService: RotationService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    // Set some test env vars
    process.env.DATABASE_PASSWORD = 'old-db-pass';
    process.env.JWT_SECRET = 'old-jwt-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretRotationScheduler,
        RotationService,
        {
          provide: SecretsLoaderService,
          useValue: {
            getSecret: jest.fn(),
            invalidate: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SECRET_PROVIDER') return 'env';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    scheduler = module.get<SecretRotationScheduler>(SecretRotationScheduler);
    rotationService = module.get<RotationService>(RotationService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    delete process.env.DATABASE_PASSWORD;
    delete process.env.JWT_SECRET;
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  it('should register default secrets on initialization', () => {
    const names = rotationService.listNames();
    expect(names).toContain('database.password');
    expect(names).toContain('jwt.secret');
  });

  describe('rotateSecret', () => {
    it('should rotate a single secret and emit event', async () => {
      const plan = await scheduler.rotateSecret('database.password');

      expect(plan.status).toBe('completed');
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].status).toBe('completed');
      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('should return failed status for unknown secret', async () => {
      const plan = await scheduler.rotateSecret('nonexistent.secret');

      expect(plan.status).toBe('failed');
      expect(plan.steps[0].status).toBe('failed');
    });
  });

  describe('executeRotationPlan', () => {
    it('should rotate multiple secrets', async () => {
      const plan = await scheduler.executeRotationPlan([
        'database.password',
        'jwt.secret',
      ]);

      expect(plan.status).toBe('completed');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps.every((s) => s.status === 'completed')).toBe(true);
    });

    it('should invalidate secrets loader cache after rotation', async () => {
      const secretsLoader = (scheduler as any).secretsLoader;
      await scheduler.rotateSecret('database.password');
      expect(secretsLoader.invalidate).toHaveBeenCalledWith('database.password');
    });
  });

  describe('rotation history', () => {
    it('should track rotation history', async () => {
      await scheduler.rotateSecret('database.password');
      await scheduler.rotateSecret('jwt.secret');

      const history = scheduler.getRotationHistory();
      expect(history).toHaveLength(2);
    });

    it('should find last rotation for a secret', async () => {
      await scheduler.rotateSecret('database.password');
      const last = scheduler.getLastRotation('database.password');
      expect(last).toBeDefined();
      expect(last!.status).toBe('completed');
    });
  });
});
