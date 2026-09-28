import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SessionFingerprintService,
  SESSION_FINGERPRINT_EVENTS,
} from './session-fingerprint.service';
import { LoginFingerprint } from './entities/login-fingerprint.entity';

describe('SessionFingerprintService (#683)', () => {
  let service: SessionFingerprintService;
  let records: LoginFingerprint[];

  const repoMock = {
    create: jest.fn((entry: Partial<LoginFingerprint>) => entry),
    save: jest.fn((entry: LoginFingerprint) => {
      const saved = { ...entry, id: `id-${records.length}`, createdAt: entry.createdAt ?? new Date() };
      records.push(saved as LoginFingerprint);
      return Promise.resolve(saved);
    }),
    findOne: jest.fn(({ where }: any) => {
      const match = records.find(
        (r) =>
          r.userId === where.userId &&
          r.fingerprintHash === where.fingerprintHash,
      );
      return Promise.resolve(match ?? null);
    }),
    find: jest.fn(({ where }: any) => {
      return Promise.resolve(
        records
          .filter((r) => r.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      );
    }),
  };

  const configServiceMock = {
    get: jest.fn((_key: string, def?: any) => def),
  };

  const eventEmitterMock = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    records = [];
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionFingerprintService,
        { provide: getRepositoryToken(LoginFingerprint), useValue: repoMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
      ],
    }).compile();

    service = module.get<SessionFingerprintService>(SessionFingerprintService);
  });

  it('computes a stable, normalized fingerprint regardless of casing/whitespace', () => {
    const a = service.computeFingerprint({
      ipAddress: ' 1.2.3.4 ',
      userAgent: 'Mozilla/5.0 (Test)',
      acceptLanguage: 'en-US',
    });
    const b = service.computeFingerprint({
      ipAddress: '1.2.3.4',
      userAgent: 'mozilla/5.0 (test)',
      acceptLanguage: 'EN-US',
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // sha256 hex digest
  });

  it('flags a brand-new fingerprint as anomalous and emits an event', async () => {
    const result = await service.checkAndRecord('user-1', {
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (Test)',
    });

    expect(result.anomalous).toBe(true);
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      SESSION_FINGERPRINT_EVENTS.ANOMALOUS_LOGIN,
      expect.objectContaining({ userId: 'user-1', fingerprintHash: result.fingerprintHash }),
    );
  });

  it('does not flag a fingerprint that matches recent history', async () => {
    const signals = { ipAddress: '5.6.7.8', userAgent: 'Chrome/100' };

    const first = await service.checkAndRecord('user-2', signals);
    expect(first.anomalous).toBe(true);

    eventEmitterMock.emit.mockClear();

    const second = await service.checkAndRecord('user-2', signals);
    expect(second.anomalous).toBe(false);
    expect(second.fingerprintHash).toBe(first.fingerprintHash);
    expect(eventEmitterMock.emit).not.toHaveBeenCalled();
  });

  it('flags a known user logging in from a new device/IP as anomalous', async () => {
    await service.checkAndRecord('user-3', {
      ipAddress: '9.9.9.9',
      userAgent: 'Chrome/100',
    });

    const fromNewDevice = await service.checkAndRecord('user-3', {
      ipAddress: '10.10.10.10',
      userAgent: 'Safari/17',
    });

    expect(fromNewDevice.anomalous).toBe(true);
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      SESSION_FINGERPRINT_EVENTS.ANOMALOUS_LOGIN,
      expect.objectContaining({ userId: 'user-3' }),
    );
  });

  it('keeps fingerprint history isolated per user', async () => {
    await service.checkAndRecord('user-4', {
      ipAddress: '1.1.1.1',
      userAgent: 'Edge/1',
    });

    const otherUserSameSignals = await service.checkAndRecord('user-5', {
      ipAddress: '1.1.1.1',
      userAgent: 'Edge/1',
    });

    expect(otherUserSameSignals.anomalous).toBe(true);
  });

  it('isKnownFingerprint reflects persisted history directly', async () => {
    const signals = { ipAddress: '2.2.2.2', userAgent: 'Firefox/99' };
    const hash = service.computeFingerprint(signals);

    expect(await service.isKnownFingerprint('user-6', hash)).toBe(false);

    await service.checkAndRecord('user-6', signals);

    expect(await service.isKnownFingerprint('user-6', hash)).toBe(true);
  });
});
