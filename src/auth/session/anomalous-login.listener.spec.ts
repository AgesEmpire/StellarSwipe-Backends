import { Test, TestingModule } from '@nestjs/testing';
import { AnomalousLoginListener } from './anomalous-login.listener';
import { UsersService } from '../../users/users.service';
import { EmailService } from '../../email/email.service';

describe('AnomalousLoginListener (#683)', () => {
  let listener: AnomalousLoginListener;

  const usersServiceMock = {
    findById: jest.fn(),
  };
  const emailServiceMock = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalousLoginListener,
        { provide: UsersService, useValue: usersServiceMock },
        { provide: EmailService, useValue: emailServiceMock },
      ],
    }).compile();

    listener = module.get<AnomalousLoginListener>(AnomalousLoginListener);
  });

  it('sends a security-alert email when the user has an email on file', async () => {
    usersServiceMock.findById.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });

    await listener.handleAnomalousLogin({
      userId: 'user-1',
      fingerprintHash: 'abc123',
      ipAddress: '1.2.3.4',
      userAgent: 'Chrome/100',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(emailServiceMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        template: 'security-alert',
        variables: expect.objectContaining({ ipAddress: '1.2.3.4' }),
      }),
    );
  });

  it('skips sending when the user has no email on file', async () => {
    usersServiceMock.findById.mockResolvedValue({ id: 'user-2', email: undefined });

    await listener.handleAnomalousLogin({
      userId: 'user-2',
      fingerprintHash: 'def456',
      occurredAt: new Date(),
    });

    expect(emailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('swallows email-send failures so the listener never throws', async () => {
    usersServiceMock.findById.mockResolvedValue({ id: 'user-3', email: 'user3@example.com' });
    emailServiceMock.sendEmail.mockRejectedValueOnce(new Error('provider down'));

    await expect(
      listener.handleAnomalousLogin({
        userId: 'user-3',
        fingerprintHash: 'ghi789',
        occurredAt: new Date(),
      }),
    ).resolves.toBeUndefined();
  });
});
