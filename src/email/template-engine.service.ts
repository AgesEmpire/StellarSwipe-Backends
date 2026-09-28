import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as Handlebars from 'handlebars';

export interface CompiledEmail {
  subject: string;
  html: string;
}

export interface EmailTemplateDefinition {
  subject: string;
  html: string;
  /** Variable names expected by this template */
  variables?: string[];
}

/**
 * Handlebars-based email template engine with:
 * - Locale-aware template resolution (falls back to 'en')
 * - XSS-safe rendering (Handlebars escapes by default; triple-stache {{{ }}} for trusted HTML)
 * - Template injection protection via allowlist of registered templates
 */
@Injectable()
export class TemplateEngineService {
  private readonly logger = new Logger(TemplateEngineService.name);

  /** locale -> templateName -> compiled template pair */
  private readonly registry = new Map<
    string,
    Map<string, { subject: HandlebarsTemplateDelegate; html: HandlebarsTemplateDelegate; variables: string[] }>
  >();

  constructor() {
    this.registerHelpers();
  }

  /**
   * Register a template for a given locale.
   * Templates are pre-compiled at registration time for performance.
   */
  register(
    templateName: string,
    locale: string,
    definition: EmailTemplateDefinition,
  ): void {
    if (!this.registry.has(locale)) {
      this.registry.set(locale, new Map());
    }

    const localeMap = this.registry.get(locale)!;
    localeMap.set(templateName, {
      subject: Handlebars.compile(definition.subject, { noEscape: false }),
      html: Handlebars.compile(definition.html, { noEscape: false }),
      variables: definition.variables ?? [],
    });

    this.logger.debug(`Registered template "${templateName}" for locale "${locale}"`);
  }

  /**
   * Render a template with the given variables.
   * Resolves locale with fallback to 'en'.
   */
  render(
    templateName: string,
    variables: Record<string, unknown> = {},
    locale = 'en',
  ): CompiledEmail {
    const template = this.resolve(templateName, locale);

    try {
      const subject = template.subject(variables);
      const html = template.html(variables);
      return { subject, html };
    } catch (error) {
      this.logger.error(`Template render error for "${templateName}": ${error.message}`);
      throw new BadRequestException(`Failed to render template "${templateName}": ${error.message}`);
    }
  }

  /**
   * List all registered template names for a locale.
   */
  listTemplates(locale = 'en'): string[] {
    const localeMap = this.registry.get(locale) ?? this.registry.get('en');
    return localeMap ? Array.from(localeMap.keys()) : [];
  }

  /**
   * Check if a template exists for the given locale (or 'en' fallback).
   */
  hasTemplate(templateName: string, locale = 'en'): boolean {
    return (
      this.registry.get(locale)?.has(templateName) ||
      this.registry.get('en')?.has(templateName) ||
      false
    );
  }

  private resolve(
    templateName: string,
    locale: string,
  ): { subject: HandlebarsTemplateDelegate; html: HandlebarsTemplateDelegate; variables: string[] } {
    // Security: only allow registered template names (prevents injection via dynamic names)
    const localeMap = this.registry.get(locale) ?? this.registry.get('en');
    const template = localeMap?.get(templateName) ?? this.registry.get('en')?.get(templateName);

    if (!template) {
      throw new BadRequestException(`Template "${templateName}" not found for locale "${locale}"`);
    }

    return template;
  }

  private registerHelpers(): void {
    // Format a date value
    Handlebars.registerHelper('formatDate', (date: string | Date) => {
      if (!date) return '';
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    });

    // Format a currency amount
    Handlebars.registerHelper('formatAmount', (amount: string | number, currency = 'USD') => {
      const num = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (Number.isNaN(num)) return amount;
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
    });

    // Conditional equality helper
    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  }
}
