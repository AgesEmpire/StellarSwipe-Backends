import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConsentService } from './consent.service';
import { UserConsent, ConsentCategory } from './entities/user-consent.entity';

function makeConsent(overrides: Partial<UserConsent> = {}): UserConsent {
  return {
    id: 'c-1',
    userId: 'user-1',
    category: ConsentCategory.MARKETING_EMAIL,
    optedIn: false,
    updatedAt: new Date('2024-01-01'),
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('ConsentService', () => {
  let service: ConsentService;
  let mockFind: jest.Mock;
  let mockFindOne: jest.Mock;
  let mockCreate: jest.Mock;
  let mockSave: jest.Mock;

  beforeEach(async () => {
    mockFind = jest.fn().mockResolvedValue([]);
    mockFindOne = jest.fn().mockResolvedValue(null);
    mockCreate = jest.fn().mockImplementation((dto) => ({ ...dto }));
    mockSave = jest.fn().mockImplementation((entity) => Promise.resolve(entity));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsentService,
        {
          provide: getRepositoryToken(UserConsent),
          useValue: { find: mockFind, findOne: mockFindOne, create: mockCreate, save: mockSave },
        },
      ],
    }).compile();

    service = module.get(ConsentService);
  });

  describe('getConsentState', () => {
    it('returns all categories with defaults when no records exist', async () => {
      mockFind.mockResolvedValue([]);
      const state = await service.getConsentState('user-1');

      expect(state.userId).toBe('user-1');
      expect(state.consents).toHaveLength(Object.values(ConsentCategory).length);
      state.consents.forEach((c) => expect(c.optedIn).toBe(false));
    });

    it('reflects stored opt-in value', async () => {
      mockFind.mockResolvedValue([
        makeConsent({ category: ConsentCategory.MARKETING_EMAIL, optedIn: true }),
      ]);

      const state = await service.getConsentState('user-1');
      const emailConsent = state.consents.find((c) => c.category === ConsentCategory.MARKETING_EMAIL);
      expect(emailConsent?.optedIn).toBe(true);
    });
  });

  describe('updateConsent — opt in', () => {
    it('creates a new consent record when none exists', async () => {
      mockFindOne.mockResolvedValue(null);
      mockFind.mockResolvedValue([]);

      await service.updateConsent('user-1', {
        category: ConsentCategory.MARKETING_EMAIL,
        optedIn: true,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', optedIn: true }),
      );
      expect(mockSave).toHaveBeenCalled();
    });

    it('updates existing consent record', async () => {
      const existing = makeConsent({ optedIn: false });
      mockFindOne.mockResolvedValue(existing);
      mockFind.mockResolvedValue([{ ...existing, optedIn: true }]);

      await service.updateConsent('user-1', {
        category: ConsentCategory.MARKETING_EMAIL,
        optedIn: true,
      });

      expect(existing.optedIn).toBe(true);
      expect(mockSave).toHaveBeenCalledWith(existing);
    });
  });

  describe('updateConsent — opt out', () => {
    it('sets optedIn to false and persists', async () => {
      const existing = makeConsent({ optedIn: true });
      mockFindOne.mockResolvedValue(existing);
      mockFind.mockResolvedValue([{ ...existing, optedIn: false }]);

      await service.updateConsent('user-1', {
        category: ConsentCategory.MARKETING_EMAIL,
        optedIn: false,
      });

      expect(existing.optedIn).toBe(false);
    });
  });

  describe('hasConsented', () => {
    it('returns true when opted in', async () => {
      mockFindOne.mockResolvedValue(makeConsent({ optedIn: true }));
      expect(await service.hasConsented('user-1', ConsentCategory.MARKETING_EMAIL)).toBe(true);
    });

    it('returns false when opted out', async () => {
      mockFindOne.mockResolvedValue(makeConsent({ optedIn: false }));
      expect(await service.hasConsented('user-1', ConsentCategory.MARKETING_EMAIL)).toBe(false);
    });

    it('returns false when no record exists', async () => {
      mockFindOne.mockResolvedValue(null);
      expect(await service.hasConsented('user-1', ConsentCategory.MARKETING_PUSH)).toBe(false);
    });
  });
});
