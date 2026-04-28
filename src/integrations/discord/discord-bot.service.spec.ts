import { Test, TestingModule } from '@nestjs/testing';
import { DiscordBotService } from './discord-bot.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiscordServer } from './entities/discord-server.entity';
import { ChannelSubscription } from './entities/channel-subscription.entity';
import { ConfigService } from '@nestjs/config';
import { buildEmbed, COLORS } from './utils/embed-builder';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((d) => d),
  save: jest.fn((d) => Promise.resolve(d)),
});

describe('DiscordBotService', () => {
  let service: DiscordBotService;
  let subRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordBotService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-token') } },
        { provide: getRepositoryToken(DiscordServer), useFactory: mockRepo },
        { provide: getRepositoryToken(ChannelSubscription), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(DiscordBotService);
    subRepo = module.get(getRepositoryToken(ChannelSubscription));
  });

  it('should upsert a new server', async () => {
    const serverRepo = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((d) => d), save: jest.fn((d) => Promise.resolve(d)) };
    (service as unknown as Record<string, unknown>)['serverRepo'] = serverRepo;
    const result = await service.upsertServer({ guildId: 'g1', guildName: 'Test Guild' });
    expect(result.guildId).toBe('g1');
  });

  it('should create new channel subscription', async () => {
    subRepo.findOne.mockResolvedValue(null);
    await service.subscribe('g1', 'ch1', 'signals');
    expect(subRepo.save).toHaveBeenCalled();
  });

  it('should update existing subscription channel', async () => {
    const existing = { channelId: 'old', isActive: false };
    subRepo.findOne.mockResolvedValue(existing);
    await service.subscribe('g1', 'ch-new', 'signals');
    expect(existing.channelId).toBe('ch-new');
    expect(existing.isActive).toBe(true);
  });

  it('should return subscribed channel ids for topic', async () => {
    subRepo.find.mockResolvedValue([{ channelId: 'ch1' }, { channelId: 'ch2' }]);
    const channels = await service.getSubscribedChannels('leaderboard');
    expect(channels).toEqual(['ch1', 'ch2']);
  });

  it('should build embed correctly', () => {
    const embed = buildEmbed('Title', 'Desc', COLORS.success);
    expect(embed.title).toBe('Title');
    expect(embed.color).toBe(COLORS.success);
    expect(embed.timestamp).toBeDefined();
  });
});
