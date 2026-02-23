import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SignalTemplateService } from './signal-template.service';
import { SignalTemplate } from './entities/signal-template.entity';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  increment: jest.fn(),
});

const baseTemplate: Partial<SignalTemplate> = {
  id: 'tpl-001',
  providerId: 'prov-001',
  name: 'Bullish Breakout',
  description: 'Standard bullish template',
  structure: {
    rationaleTemplate: 'Bullish {{asset}} breakout on {{timeframe}}',
    stopLossFormula: 'entry_price * 0.95',
    takeProfitFormula: 'entry_price * 1.15',
    direction: 'LONG',
    timeframe: '{{timeframe}}',
  },
  variables: ['asset', 'entry_price', 'timeframe'],
  usageCount: 5,
  isPublic: false,
  isActive: true,
  version: 1,
  previousVersionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('SignalTemplateService', () => {
  let service: SignalTemplateService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalTemplateService,
        { provide: getRepositoryToken(SignalTemplate), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<SignalTemplateService>(SignalTemplateService);
    repo = module.get(getRepositoryToken(SignalTemplate));
  });

  // ─── CREATE ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('saves a valid template', async () => {
      repo.create.mockReturnValue(baseTemplate);
      repo.save.mockResolvedValue(baseTemplate);

      const result = await service.create('prov-001', {
        name: 'Bullish Breakout',
        structure: {
          rationaleTemplate: 'Bullish {{asset}} breakout on {{timeframe}}',
          stopLossFormula: 'entry_price * 0.95',
          takeProfitFormula: 'entry_price * 1.15',
          direction: 'LONG',
          timeframe: '{{timeframe}}',
        },
        variables: ['asset', 'entry_price', 'timeframe'],
      });

      expect(repo.save).toHaveBeenCalled();
      expect(result.name).toBe('Bullish Breakout');
    });

    it('throws if placeholder not in variables list', async () => {
      await expect(
        service.create('prov-001', {
          name: 'Test',
          structure: {
            rationaleTemplate: 'Buy {{asset}} at {{undeclared_var}}',
            stopLossFormula: 'entry_price * 0.95',
            takeProfitFormula: 'entry_price * 1.10',
          },
          variables: ['asset', 'entry_price'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── FIND ONE ────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns template when found', async () => {
      repo.findOne.mockResolvedValue(baseTemplate);
      const result = await service.findOne('tpl-001');
      expect(result.id).toBe('tpl-001');
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GENERATE SIGNAL ─────────────────────────────────────────────────────

  describe('generateSignal', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(baseTemplate);
      repo.increment.mockResolvedValue({});
    });

    it('substitutes variables and evaluates formulas', async () => {
      const result = await service.generateSignal(
        {
          templateId: 'tpl-001',
          variables: { asset: 'USDC/XLM', entry_price: 0.1, timeframe: '4H' },
        },
        'prov-001',
      );

      expect(result.rationale).toBe('Bullish USDC/XLM breakout on 4H');
      expect(result.stopLoss).toBeCloseTo(0.095, 5);
      expect(result.takeProfit).toBeCloseTo(0.115, 5);
      expect(result.direction).toBe('LONG');
    });

    it('throws if required variable is missing', async () => {
      await expect(
        service.generateSignal(
          { templateId: 'tpl-001', variables: { asset: 'BTC/USD' } }, // missing entry_price, timeframe
          'prov-001',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException for private template from another provider', async () => {
      repo.findOne.mockResolvedValue({ ...baseTemplate, isPublic: false });
      await expect(
        service.generateSignal(
          {
            templateId: 'tpl-001',
            variables: { asset: 'ETH/USD', entry_price: 2000, timeframe: '1D' },
          },
          'other-provider',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows another provider to use a public template', async () => {
      repo.findOne.mockResolvedValue({ ...baseTemplate, isPublic: true });
      const result = await service.generateSignal(
        {
          templateId: 'tpl-001',
          variables: { asset: 'ETH/USD', entry_price: 2000, timeframe: '1D' },
        },
        'other-provider',
      );
      expect(result.stopLoss).toBeCloseTo(1900, 2);
    });

    it('rejects invalid stop loss (above entry for LONG)', async () => {
      // stop loss formula: entry * 1.05 would be above entry for LONG
      repo.findOne.mockResolvedValue({
        ...baseTemplate,
        structure: {
          ...baseTemplate.structure,
          stopLossFormula: 'entry_price * 1.05', // wrong direction
          takeProfitFormula: 'entry_price * 1.15',
          direction: 'LONG',
        },
      });

      await expect(
        service.generateSignal(
          { templateId: 'tpl-001', variables: { asset: 'BTC', entry_price: 50000, timeframe: '4H' } },
          'prov-001',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unsafe formula expressions', async () => {
      repo.findOne.mockResolvedValue({
        ...baseTemplate,
        structure: {
          ...baseTemplate.structure,
          stopLossFormula: 'process.exit(1)',
        },
      });

      await expect(
        service.generateSignal(
          { templateId: 'tpl-001', variables: { asset: 'BTC', entry_price: 50000, timeframe: '4H' } },
          'prov-001',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── UPDATE ──────────────────────────────────────────────────────────────

  describe('update', () => {
    it('bumps version on update', async () => {
      repo.findOne.mockResolvedValue({ ...baseTemplate });
      repo.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.update('tpl-001', 'prov-001', { name: 'New Name' });
      expect(result.version).toBe(2);
      expect(result.name).toBe('New Name');
    });

    it('throws ForbiddenException for non-owner', async () => {
      repo.findOne.mockResolvedValue(baseTemplate);
      await expect(
        service.update('tpl-001', 'other-prov', { name: 'Hack' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── CLONE ───────────────────────────────────────────────────────────────

  describe('cloneTemplate', () => {
    it('clones a public template', async () => {
      repo.findOne.mockResolvedValue({ ...baseTemplate, isPublic: true });
      repo.create.mockImplementation((data) => data);
      repo.save.mockImplementation((t) => Promise.resolve({ ...t, id: 'new-id' }));

      const clone = await service.cloneTemplate('tpl-001', 'other-provider');
      expect(clone.providerId).toBe('other-provider');
      expect(clone.name).toContain('copy');
      expect(clone.usageCount).toBe(0);
    });

    it('throws when cloning private template from another provider', async () => {
      repo.findOne.mockResolvedValue({ ...baseTemplate, isPublic: false });
      await expect(
        service.cloneTemplate('tpl-001', 'attacker-provider'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
