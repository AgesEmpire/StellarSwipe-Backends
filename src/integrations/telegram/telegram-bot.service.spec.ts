import { Test, TestingModule } from '@nestjs/testing';
import { TelegramBotService } from './telegram-bot.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TelegramUser } from './entities/telegram-user.entity';
import { BotSubscription } from './entities/bot-subscription.entity';
import { ConfigService } from '@nestjs/config';

const mockUserRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((d) => d),
  save: jest.fn((d) => Promise.resolve(d)),
});

const mockSubRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((d) => d),
  save: jest.fn((d) => Promise.resolve(d)),
  update: jest.fn(),
});

describe('TelegramBotService', () => {
  let service: TelegramBotService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let subRepo: ReturnType<typeof mockSubRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramBotService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-token') } },
        { provide: getRepositoryToken(TelegramUser), useFactory: mockUserRepo },
        { provide: getRepositoryToken(BotSubscription), useFactory: mockSubRepo },
      ],
    }).compile();

    service = module.get(TelegramBotService);
    userRepo = module.get(getRepositoryToken(TelegramUser));
    subRepo = module.get(getRepositoryToken(BotSubscription));
  });

  it('should upsert a new user', async () => {
    userRepo.findOne.mockResolvedValue(null);
    const user = await service.upsertUser(123456, 'testuser', 'Test');
    expect(userRepo.save).toHaveBeenCalled();
    expect(user.telegramId).toBe(123456);
  });

  it('should update existing user', async () => {
    const existing = { telegramId: 123456, username: 'old', firstName: 'Old' };
    userRepo.findOne.mockResolvedValue(existing);
    await service.upsertUser(123456, 'new', 'New');
    expect(existing.username).toBe('new');
    expect(userRepo.save).toHaveBeenCalled();
  });

  it('should create new subscription', async () => {
    subRepo.findOne.mockResolvedValue(null);
    await service.subscribe(123456, 'signals');
    expect(subRepo.save).toHaveBeenCalled();
  });

  it('should reactivate existing subscription', async () => {
    const existing = { isActive: false };
    subRepo.findOne.mockResolvedValue(existing);
    await service.subscribe(123456, 'signals');
    expect(existing.isActive).toBe(true);
    expect(subRepo.save).toHaveBeenCalled();
  });

  it('should return active subscriber ids', async () => {
    subRepo.find.mockResolvedValue([{ telegramId: 111 }, { telegramId: 222 }]);
    const ids = await service.getActiveSubscribers('trades');
    expect(ids).toEqual([111, 222]);
  });
});
