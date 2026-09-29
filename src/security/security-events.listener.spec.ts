import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SecurityEventsListener } from './security-events.listener';
import { UserService } from '../user/user.service';
import { SecurityEventType } from './security-event-type.enum';

describe('SecurityEventsListener', () => {
  let listener: SecurityEventsListener;
  let userService: { findById: jest.Mock };

  const buildEvent = (overrides: Record<string, unknown> = {}) => ({
    type: SecurityEventType.LOGIN_FAILURE,
    userId: 'user-1',
    ip: '127.0.0.1',
    metadata: {},
    ...overrides,
  });

  beforeEach(async () => {
    userService = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityEventsListener,
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    listener = module.get<SecurityEventsListener>(SecurityEventsListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the user through the injected user service on lookup success', async () => {
    const user = { id: 'user-1', email: 'user@example.com' };
    userService.findById.mockResolvedValue(user);

    const result = await listener.handleSecurityEvent(buildEvent());

    expect(userService.findById).toHaveBeenCalledWith('user-1');
    expect(result).toEqual(expect.objectContaining({ userId: 'user-1' }));
  });

  it('handles a missing or deleted user deterministically without leaking existence', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    userService.findById.mockResolvedValue(null);

    await expect(listener.handleSecurityEvent(buildEvent())).resolves.toBeDefined();

    expect(userService.findById).toHaveBeenCalledWith('user-1');
    const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('user-1');
    expect(logged).not.toContain('user@example.com');
  });

  it('handles a user service failure without throwing or leaking account existence', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    userService.findById.mockRejectedValue(new Error('user service unavailable'));

    await expect(listener.handleSecurityEvent(buildEvent())).resolves.toBeDefined();

    expect(userService.findById).toHaveBeenCalledWith('user-1');
    const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('user-1');
  });
});
