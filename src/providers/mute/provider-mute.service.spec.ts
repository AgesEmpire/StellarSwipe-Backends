import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderMuteService } from './provider-mute.service';
import { UserProviderMute } from '../entities/user-provider-mute.entity';

const USER_ID = 'user-1';
const PROVIDER_ID = 'provider-1';

describe('ProviderMuteService', () => {
  let service: ProviderMuteService;
  let repo: jest.Mocked<Repository<UserProviderMute>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderMuteService,
        {
          provide: getRepositoryToken(UserProviderMute),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ProviderMuteService);
    repo = module.get(getRepositoryToken(UserProviderMute));
  });

  describe('mute', () => {
    it('creates a mute record when none exists', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue({ userId: USER_ID, providerId: PROVIDER_ID } as UserProviderMute);
      repo.save.mockResolvedValue({} as UserProviderMute);

      await service.mute(USER_ID, PROVIDER_ID);

      expect(repo.save).toHaveBeenCalled();
    });

    it('is idempotent — skips save when mute already exists', async () => {
      repo.findOne.mockResolvedValue({ id: 'existing' } as UserProviderMute);

      await service.mute(USER_ID, PROVIDER_ID);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('unmute', () => {
    it('deletes the mute record', async () => {
      repo.delete.mockResolvedValue({ affected: 1, raw: [] });

      await service.unmute(USER_ID, PROVIDER_ID);

      expect(repo.delete).toHaveBeenCalledWith({ userId: USER_ID, providerId: PROVIDER_ID });
    });
  });

  describe('isMuted', () => {
    it('returns true when mute record exists', async () => {
      repo.count.mockResolvedValue(1);
      expect(await service.isMuted(USER_ID, PROVIDER_ID)).toBe(true);
    });

    it('returns false when no mute record', async () => {
      repo.count.mockResolvedValue(0);
      expect(await service.isMuted(USER_ID, PROVIDER_ID)).toBe(false);
    });
  });

  describe('getMutedProviderIds', () => {
    it('returns list of muted provider ids for a user', async () => {
      repo.find.mockResolvedValue([
        { providerId: 'p-1' } as UserProviderMute,
        { providerId: 'p-2' } as UserProviderMute,
      ]);

      const ids = await service.getMutedProviderIds(USER_ID);

      expect(ids).toEqual(['p-1', 'p-2']);
    });

    it('returns empty array when user has no mutes', async () => {
      repo.find.mockResolvedValue([]);
      expect(await service.getMutedProviderIds(USER_ID)).toEqual([]);
    });
  });
});
