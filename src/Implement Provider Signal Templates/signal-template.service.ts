import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignalTemplate, TemplateStructure } from './entities/signal-template.entity';
import { CreateTemplateDto } from '../dto/create-template.dto';
import { UpdateTemplateDto, UseTemplateDto } from '../dto/use-template.dto';

export interface GeneratedSignal {
  rationale: string;
  stopLoss: number;
  takeProfit: number;
  direction?: string;
  timeframe?: string;
  additionalNotes?: string;
  templateId: string;
  templateVersion: number;
  variables: Record<string, string | number>;
}

@Injectable()
export class SignalTemplateService {
  private readonly logger = new Logger(SignalTemplateService.name);
  // Allowed math operations for formula evaluation (safe subset)
  private readonly SAFE_MATH_PATTERN = /^[\d\s\+\-\*\/\.\(\)entry_price]+$/;

  constructor(
    @InjectRepository(SignalTemplate)
    private readonly templateRepo: Repository<SignalTemplate>,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(providerId: string, dto: CreateTemplateDto): Promise<SignalTemplate> {
    this.validateVariablesConsistency(dto.structure, dto.variables);

    const template = this.templateRepo.create({
      ...dto,
      providerId,
      usageCount: 0,
      version: 1,
    });

    return this.templateRepo.save(template);
  }

  async findAllForProvider(providerId: string): Promise<SignalTemplate[]> {
    return this.templateRepo.find({
      where: { providerId, isActive: true },
      order: { usageCount: 'DESC', createdAt: 'DESC' },
    });
  }

  async findPublicTemplates(): Promise<SignalTemplate[]> {
    return this.templateRepo.find({
      where: { isPublic: true, isActive: true },
      order: { usageCount: 'DESC' },
    });
  }

  async findOne(id: string): Promise<SignalTemplate> {
    const template = await this.templateRepo.findOne({ where: { id, isActive: true } });
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return template;
  }

  async update(
    id: string,
    providerId: string,
    dto: UpdateTemplateDto,
  ): Promise<SignalTemplate> {
    const template = await this.findOne(id);
    this.assertOwner(template, providerId);

    // Archive current version by creating a snapshot reference
    const updatedStructure = dto.structure
      ? { ...template.structure, ...dto.structure }
      : template.structure;

    const updatedVariables = dto.variables ?? template.variables;

    if (dto.structure || dto.variables) {
      this.validateVariablesConsistency(updatedStructure, updatedVariables);
    }

    // Bump version
    Object.assign(template, {
      ...dto,
      structure: updatedStructure,
      variables: updatedVariables,
      version: template.version + 1,
      previousVersionId: template.id,
    });

    return this.templateRepo.save(template);
  }

  async softDelete(id: string, providerId: string): Promise<void> {
    const template = await this.findOne(id);
    this.assertOwner(template, providerId);
    template.isActive = false;
    await this.templateRepo.save(template);
  }

  // ─── Template Usage ───────────────────────────────────────────────────────

  /**
   * Generate a signal object from a template + variable values.
   * Does NOT persist the signal — caller handles persistence.
   */
  async generateSignal(
    dto: UseTemplateDto,
    requestingProviderId: string,
  ): Promise<GeneratedSignal> {
    const template = await this.findOne(dto.templateId);

    // Access check: provider owns it OR it is public
    if (template.providerId !== requestingProviderId && !template.isPublic) {
      throw new ForbiddenException('You do not have access to this template');
    }

    this.validateVariableInputs(template.variables, dto.variables);

    const rationale = this.substituteVariables(
      template.structure.rationaleTemplate,
      dto.variables,
    );

    const entryPrice = this.resolveNumeric(dto.variables['entry_price']);
    const stopLoss = this.evaluateFormula(template.structure.stopLossFormula, {
      ...dto.variables,
      entry_price: entryPrice,
    });
    const takeProfit = this.evaluateFormula(template.structure.takeProfitFormula, {
      ...dto.variables,
      entry_price: entryPrice,
    });

    const direction = template.structure.direction
      ? this.substituteVariables(template.structure.direction, dto.variables)
      : undefined;

    const timeframe = template.structure.timeframe
      ? this.substituteVariables(template.structure.timeframe, dto.variables)
      : undefined;

    const additionalNotes = template.structure.additionalNotes
      ? this.substituteVariables(template.structure.additionalNotes, dto.variables)
      : undefined;

    // Validate financial sanity
    this.validateSignalValues(entryPrice, stopLoss, takeProfit, direction);

    // Increment usage counter (fire-and-forget)
    this.incrementUsage(template.id).catch((err) =>
      this.logger.error(`Failed to increment usage for template ${template.id}`, err),
    );

    return {
      rationale,
      stopLoss,
      takeProfit,
      direction,
      timeframe,
      additionalNotes,
      templateId: template.id,
      templateVersion: template.version,
      variables: dto.variables,
    };
  }

  async getUsageAnalytics(
    providerId: string,
  ): Promise<{ templateId: string; name: string; usageCount: number }[]> {
    const templates = await this.templateRepo.find({
      where: { providerId },
      select: ['id', 'name', 'usageCount'],
      order: { usageCount: 'DESC' },
    });
    return templates.map((t) => ({ templateId: t.id, name: t.name, usageCount: t.usageCount }));
  }

  // ─── Template Cloning (sharing) ──────────────────────────────────────────

  async cloneTemplate(templateId: string, targetProviderId: string): Promise<SignalTemplate> {
    const source = await this.findOne(templateId);

    if (!source.isPublic && source.providerId !== targetProviderId) {
      throw new ForbiddenException('Cannot clone a private template you do not own');
    }

    const clone = this.templateRepo.create({
      ...source,
      id: undefined,
      providerId: targetProviderId,
      name: `${source.name} (copy)`,
      usageCount: 0,
      version: 1,
      previousVersionId: null,
      isPublic: false,
    });

    return this.templateRepo.save(clone);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private substituteVariables(
    template: string,
    variables: Record<string, string | number>,
  ): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key in variables) return String(variables[key]);
      throw new BadRequestException(`Missing variable value for placeholder: {{${key}}}`);
    });
  }

  private evaluateFormula(
    formula: string,
    variables: Record<string, string | number>,
  ): number {
    // Replace known variable names in formula
    let expression = formula;
    for (const [key, value] of Object.entries(variables)) {
      expression = expression.replace(new RegExp(`\\b${key}\\b`, 'g'), String(value));
    }

    // Safety check — only allow numeric math expressions
    if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expression)) {
      throw new BadRequestException(
        `Formula produced unsafe expression: "${expression}". Only numeric arithmetic is allowed.`,
      );
    }

    try {
      // eslint-disable-next-line no-eval
      const result = Function(`"use strict"; return (${expression})`)() as number;
      if (!isFinite(result)) throw new Error('Result is not finite');
      return parseFloat(result.toFixed(8));
    } catch {
      throw new BadRequestException(
        `Failed to evaluate formula: "${formula}" → expression: "${expression}"`,
      );
    }
  }

  private validateVariablesConsistency(
    structure: Partial<TemplateStructure>,
    declaredVariables: string[],
  ): void {
    const allText = Object.values(structure).join(' ');
    const usedPlaceholders = [...allText.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const uniqueUsed = [...new Set(usedPlaceholders)];
    const undeclared = uniqueUsed.filter((v) => !declaredVariables.includes(v));

    if (undeclared.length) {
      throw new BadRequestException(
        `Placeholders used but not declared in variables: ${undeclared.join(', ')}`,
      );
    }
  }

  private validateVariableInputs(
    declared: string[],
    provided: Record<string, string | number>,
  ): void {
    const missing = declared.filter((v) => !(v in provided));
    if (missing.length) {
      throw new BadRequestException(`Missing required variables: ${missing.join(', ')}`);
    }

    // Validate entry_price if present
    if ('entry_price' in provided) {
      const ep = this.resolveNumeric(provided['entry_price']);
      if (isNaN(ep) || ep <= 0) {
        throw new BadRequestException('entry_price must be a positive number');
      }
    }
  }

  private validateSignalValues(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    direction?: string,
  ): void {
    if (isNaN(stopLoss) || stopLoss <= 0)
      throw new BadRequestException('Calculated stop loss is invalid');
    if (isNaN(takeProfit) || takeProfit <= 0)
      throw new BadRequestException('Calculated take profit is invalid');

    const dir = direction?.toUpperCase();
    if (dir === 'LONG' || !dir) {
      if (stopLoss >= entryPrice)
        throw new BadRequestException('Stop loss must be below entry price for LONG signals');
      if (takeProfit <= entryPrice)
        throw new BadRequestException('Take profit must be above entry price for LONG signals');
    } else if (dir === 'SHORT') {
      if (stopLoss <= entryPrice)
        throw new BadRequestException('Stop loss must be above entry price for SHORT signals');
      if (takeProfit >= entryPrice)
        throw new BadRequestException('Take profit must be below entry price for SHORT signals');
    }
  }

  private resolveNumeric(value: string | number): number {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) throw new BadRequestException(`Value "${value}" is not a valid number`);
    return num;
  }

  private assertOwner(template: SignalTemplate, providerId: string): void {
    if (template.providerId !== providerId) {
      throw new ForbiddenException('You do not own this template');
    }
  }

  private async incrementUsage(templateId: string): Promise<void> {
    await this.templateRepo.increment({ id: templateId }, 'usageCount', 1);
  }
}
