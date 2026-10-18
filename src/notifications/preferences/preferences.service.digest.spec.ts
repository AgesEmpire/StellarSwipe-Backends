import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PreferencesService } from './preferences.service';
import { NotificationPreference } from './entities/notification-preference.entity';

describe('PreferencesService digest scheduling', () => {
  let service: PreferencesService;
  let mockRepository: any;

  const basePreference = (overrides: Partial<NotificationPreference> = {}): NotificationPreference =>
    ({
      userId: 'user-1',
      digestEnabled: true,
      digestFrequency: 'daily',
      digestHour: 9,
      timezone: 'UTC',
      quietHoursEnabled: false,
      quietHoursStart: undefined,
      quietHoursEnd: undefined,
      ...overrides,
    }) as NotificationPreference;

  beforeEach(async () => {
    mockRepository = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferencesService,
        { provide: getRepositoryToken(NotificationPreference), useValue: mockRepository },
      ],
    }).compile();

    service = module.get(PreferencesService);
  });

  it('is not due when digest is disabled', () => {
    const preference = basePreference({ digestEnabled: false });
    expect(service.isDigestDue(preference, new Date('2026-01-01T09:30:00Z'))).toBe(false);
  });

  it('is due every run for hourly frequency (outside quiet hours)', () => {
    const preference = basePreference({ digestFrequency: 'hourly' });
    expect(service.isDigestDue(preference, new Date('2026-01-01T14:05:00Z'))).toBe(true);
  });

  it('is due only at the configured hour for daily frequency', () => {
    const preference = basePreference({ digestFrequency: 'daily', digestHour: 9, timezone: 'UTC' });
    expect(service.isDigestDue(preference, new Date('2026-01-01T09:15:00Z'))).toBe(true);
    expect(service.isDigestDue(preference, new Date('2026-01-01T10:15:00Z'))).toBe(false);
  });

  it('defers (is not due) while the user is within quiet hours', () => {
    const preference = basePreference({
      digestFrequency: 'hourly',
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'UTC',
    });
    // 23:00 UTC falls inside the 22:00-07:00 quiet window.
    expect(service.isDigestDue(preference, new Date('2026-01-01T23:00:00Z'))).toBe(false);
    // 12:00 UTC does not.
    expect(service.isDigestDue(preference, new Date('2026-01-01T12:00:00Z'))).toBe(true);
  });

  it('findPreferencesDueForDigest filters candidates down to those actually due', async () => {
    mockRepository.find.mockResolvedValue([
      basePreference({ userId: 'due-daily', digestFrequency: 'daily', digestHour: 9 }),
      basePreference({ userId: 'not-due-daily', digestFrequency: 'daily', digestHour: 14 }),
      basePreference({ userId: 'due-hourly', digestFrequency: 'hourly' }),
    ]);

    const result = await service.findPreferencesDueForDigest(new Date('2026-01-01T09:00:00Z'));

    expect(mockRepository.find).toHaveBeenCalledWith({ where: { digestEnabled: true } });
    expect(result.map((p) => p.userId).sort()).toEqual(['due-daily', 'due-hourly']);
  });
});
