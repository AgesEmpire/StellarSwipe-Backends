import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationTemplate, NotificationChannel } from './entities/notification-template.entity';

describe('NotificationTemplateService', () => {
  let service: NotificationTemplateService;
  const mockTemplateRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationTemplateService,
        {
          provide: getRepositoryToken(NotificationTemplate),
          useValue: mockTemplateRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationTemplateService>(NotificationTemplateService);
  });

  describe('renderTemplate with variable substitution', () => {
    it('should render email template with variables', async () => {
      const template: NotificationTemplate = {
        id: '1',
        name: 'Trade Executed',
        key: 'trade-executed',
        emailSubject: 'Trade: {{amount}} {{symbol}}',
        emailBody: '<p>You sold {{amount}} {{symbol}} at {{price}}</p>',
        emailPlainText: 'You sold {{amount}} {{symbol}} at {{price}}',
        smsBody: '',
        inAppTitle: '',
        inAppBody: '',
        pushTitle: '',
        pushBody: '',
        fallbackTitle: '',
        fallbackMessage: '',
        isActive: true,
        variables: ['amount', 'symbol', 'price'],
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Trade notification',
      };

      mockTemplateRepository.findOne.mockResolvedValue(template);

      const result = await service.renderTemplate(
        'trade-executed',
        { amount: '100', symbol: 'XLM', price: '0.50' },
        [NotificationChannel.EMAIL],
      );

      expect(result).toHaveLength(1);
      expect(result[0].subject).toBe('Trade: 100 XLM');
      expect(result[0].body).toContain('You sold 100 XLM at 0.50');
    });

    it('should render SMS with truncated variables', async () => {
      const template: NotificationTemplate = {
        id: '2',
        name: 'Low Balance',
        key: 'low-balance',
        emailSubject: '',
        emailBody: '',
        emailPlainText: '',
        smsBody: 'Low balance: {{balance}} {{currency}}',
        inAppTitle: '',
        inAppBody: '',
        pushTitle: '',
        pushBody: '',
        fallbackTitle: 'Alert',
        fallbackMessage: 'Low balance alert',
        isActive: true,
        variables: ['balance', 'currency'],
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Low balance notification',
      };

      mockTemplateRepository.findOne.mockResolvedValue(template);

      const result = await service.renderTemplate(
        'low-balance',
        { balance: '25.50', currency: 'USD' },
        [NotificationChannel.SMS],
      );

      expect(result[0].body).toBe('Low balance: 25.50 USD');
    });

    it('should support multi-channel rendering', async () => {
      const template: NotificationTemplate = {
        id: '3',
        name: 'Test Multi',
        key: 'multi-test',
        emailSubject: 'Subject: {{event}}',
        emailBody: 'Email: {{event}}',
        emailPlainText: '',
        smsBody: 'SMS: {{event}}',
        inAppTitle: 'Title: {{event}}',
        inAppBody: 'Body: {{event}}',
        pushTitle: 'Push: {{event}}',
        pushBody: 'Content: {{event}}',
        fallbackTitle: '',
        fallbackMessage: '',
        isActive: true,
        variables: ['event'],
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Multi-channel test',
      };

      mockTemplateRepository.findOne.mockResolvedValue(template);

      const result = await service.renderTemplate(
        'multi-test',
        { event: 'TestEvent' },
        [NotificationChannel.EMAIL, NotificationChannel.SMS, NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );

      expect(result).toHaveLength(4);
      expect(result[0].subject).toBe('Subject: TestEvent');
      expect(result[1].body).toBe('SMS: TestEvent');
      expect(result[2].title).toBe('Title: TestEvent');
      expect(result[3].title).toBe('Push: TestEvent');
    });
  });

  describe('Fallback content handling', () => {
    it('should use fallback when template not found', async () => {
      mockTemplateRepository.findOne.mockResolvedValue(null);

      const result = await service.renderTemplate('non-existent', {}, [NotificationChannel.EMAIL]);

      expect(result[0].body).toBe('You have a notification');
      expect(result[0].title).toBe('Notification');
    });

    it('should use template fallback title when channel title is missing', async () => {
      const template: NotificationTemplate = {
        id: '4',
        name: 'Fallback Test',
        key: 'fallback-test',
        emailSubject: '',
        emailBody: '',
        emailPlainText: '',
        smsBody: '',
        inAppTitle: null as any,
        inAppBody: '',
        pushTitle: null as any,
        pushBody: '',
        fallbackTitle: 'Generic Alert',
        fallbackMessage: 'Something happened',
        isActive: true,
        variables: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Fallback test',
      };

      mockTemplateRepository.findOne.mockResolvedValue(template);

      const result = await service.renderTemplate(
        'fallback-test',
        {},
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );

      expect(result[0].title).toBe('Generic Alert');
      expect(result[1].title).toBe('Generic Alert');
    });
  });

  describe('Template management', () => {
    it('should upsert a new template', async () => {
      mockTemplateRepository.findOne.mockResolvedValue(null);
      const newTemplate = { key: 'new-template', name: 'New' };
      mockTemplateRepository.save.mockResolvedValue(newTemplate);

      const result = await service.upsertTemplate(newTemplate);
      expect(mockTemplateRepository.save).toHaveBeenCalled();
    });

    it('should update existing template', async () => {
      const existing = { id: '1', key: 'existing', name: 'Existing' };
      mockTemplateRepository.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
      mockTemplateRepository.update.mockResolvedValue({});

      await service.upsertTemplate({ key: 'existing', name: 'Updated' });
      expect(mockTemplateRepository.update).toHaveBeenCalledWith('1', expect.any(Object));
    });
  });
});
