import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserPreference } from './entities/user-preference.entity';
import { Session } from './entities/session.entity';
import { createMockRepository } from '../../test/utils/test-helpers';
import { userFactory, sessionFactory } from '../../test/utils/mock-factories';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: ReturnType<typeof createMockRepository>;
  let preferenceRepository: ReturnType<typeof createMockRepository>;
  let sessionRepository: ReturnType<typeof createMockRepository>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    userRepository = createMockRepository<User>();
    preferenceRepository = createMockRepository<UserPreference>();
    sessionRepository = createMockRepository<Session>();
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(UserPreference), useValue: preferenceRepository },
        { provide: getRepositoryToken(Session), useValue: sessionRepository },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create a new user with preferences', async () => {
      const dto = { username: 'testuser', walletAddress: 'GABC123...' };
      const user = userFactory(dto);
      const preference = { id: 'pref-123', userId: user.id };

      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(user);
      userRepository.save.mockResolvedValue(user);
      preferenceRepository.create.mockReturnValue(preference);
      preferenceRepository.save.mockResolvedValue(preference);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(user);

      const result = await service.createUser(dto);

      expect(result).toBeDefined();
      expect(userRepository.save).toHaveBeenCalled();
      expect(preferenceRepository.save).toHaveBeenCalled();
    });

    it('emits a provider.created event so the provider becomes searchable', async () => {
      const dto = { username: 'testuser', walletAddress: 'GABC123...' };
      const user = userFactory(dto);
      const preference = { id: 'pref-123', userId: user.id };

      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(user);
      userRepository.save.mockResolvedValue(user);
      preferenceRepository.create.mockReturnValue(preference);
      preferenceRepository.save.mockResolvedValue(preference);
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(user);

      const result = await service.createUser(dto);

      expect(eventEmitter.emit).toHaveBeenCalledWith('provider.created', result);
    });

    it('should throw ConflictException if wallet already exists', async () => {
      const dto = { username: 'testuser', walletAddress: 'GABC123...' };
      const existingUser = userFactory({ walletAddress: dto.walletAddress });

      userRepository.findOne.mockResolvedValue(existingUser);

      await expect(service.createUser(dto)).rejects.toThrow(ConflictException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should restore soft-deleted user', async () => {
      const dto = { username: 'testuser', walletAddress: 'GABC123...' };
      const deletedUser = userFactory({ ...dto, deletedAt: new Date() });

      userRepository.findOne.mockResolvedValueOnce(deletedUser).mockResolvedValueOnce(deletedUser);
      userRepository.restore.mockResolvedValue({ affected: 1 } as any);

      await service.createUser(dto);

      expect(userRepository.restore).toHaveBeenCalledWith(deletedUser.id);
    });
  });

  describe('findById', () => {
    it('should return user by id', async () => {
      const user = userFactory();
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findById('user-123');

      expect(result).toEqual(user);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        relations: ['preference', 'sessions'],
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByWalletAddress', () => {
    it('should return user by wallet address', async () => {
      const user = userFactory();
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findByWalletAddress('GABC123...');

      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findByWalletAddress('GABC123...')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOrCreateByWalletAddress', () => {
    it('should return existing user', async () => {
      const user = userFactory();
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.findOrCreateByWalletAddress('GABC123...');

      expect(result).toEqual(user);
    });

    it('should create new user if not found', async () => {
      const user = userFactory();
      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(user);
      userRepository.create.mockReturnValue(user);
      userRepository.save.mockResolvedValue(user);
      preferenceRepository.create.mockReturnValue({} as any);
      preferenceRepository.save.mockResolvedValue({} as any);

      const result = await service.findOrCreateByWalletAddress('GABC123...');

      expect(result).toBeDefined();
      expect(userRepository.save).toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const user = userFactory();
      const session = sessionFactory();

      userRepository.findOne.mockResolvedValue(user);
      sessionRepository.create.mockReturnValue(session);
      sessionRepository.save.mockResolvedValue(session);

      const result = await service.createSession(
        'GABC123...',
        'token-123',
        new Date(),
        'Chrome',
        '127.0.0.1',
      );

      expect(result).toEqual(session);
      expect(sessionRepository.save).toHaveBeenCalled();
    });
  });

  describe('invalidateSession', () => {
    it('should invalidate a session', async () => {
      sessionRepository.update.mockResolvedValue({ affected: 1 } as any);

      await service.invalidateSession('token-123');

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { token: 'token-123' },
        { isActive: false },
      );
    });
  });

  describe('updateWalletAddress', () => {
    it('should update wallet address', async () => {
      const user = userFactory();
      userRepository.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
      userRepository.save.mockResolvedValue({ ...user, walletAddress: 'NEW123...' });

      const result = await service.updateWalletAddress('user-123', 'NEW123...');

      expect(result.walletAddress).toBe('NEW123...');
    });

    it('should throw ConflictException if wallet already linked', async () => {
      const user = userFactory();
      const otherUser = userFactory({ id: 'other-123', walletAddress: 'NEW123...' });

      userRepository.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce(otherUser);

      await expect(service.updateWalletAddress('user-123', 'NEW123...')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
