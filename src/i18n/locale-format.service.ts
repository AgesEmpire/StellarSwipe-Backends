/**
 * LocaleFormatService (#704)
 *
 * Formats numeric (currency, percentage) and date values according to a
 * resolved locale, using the built-in Intl APIs (zero extra dependencies).
 *
 * Raw machine-readable values are always preserved alongside formatted ones.
 */
import { Injectable } from '@nestjs/common';

export interface FormattedNumber {
  raw: number;
  display: string;
}

export interface FormattedDate {
  raw: string; // ISO-8601
  display: string;
}

/** Fields whose values should be formatted as currency amounts */
const CURRENCY_FIELDS = new Set([
  'amount',
  'price',
  'balance',
  'total',
  'fee',
  'payout',
  'revenue',
  'earnings',
  'value',
]);

/** Fields whose values should be formatted as percentages */
const PERCENT_FIELDS = new Set([
  'percentage',
  'percent',
  'rate',
  'roi',
  'apy',
  'slippage',
  'change',
  'ratio',
]);

/** Fields whose values should be formatted as dates */
const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'deletedAt',
  'expiresAt',
  'date',
  'timestamp',
  'startDate',
  'endDate',
]);

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_CURRENCY = 'USD';

@Injectable()
export class LocaleFormatService {
  /**
   * Resolves a BCP-47 locale from an Accept-Language header value.
   * Falls back to DEFAULT_LOCALE for anything unrecognised.
   */
  resolveLocale(acceptLanguage?: string): string {
    if (!acceptLanguage) return DEFAULT_LOCALE;
    const tag = acceptLanguage.split(',')[0].trim().split(';')[0].trim();
    try {
      // Validate via Intl — throws RangeError for invalid tags
      Intl.getCanonicalLocales(tag);
      return tag;
    } catch {
      return DEFAULT_LOCALE;
    }
  }

  formatCurrency(value: number, locale: string, currency = DEFAULT_CURRENCY): FormattedNumber {
    try {
      const display = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
      }).format(value);
      return { raw: value, display };
    } catch {
      return { raw: value, display: String(value) };
    }
  }

  formatPercent(value: number, locale: string): FormattedNumber {
    try {
      const display = new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }).format(value / 100);
      return { raw: value, display };
    } catch {
      return { raw: value, display: String(value) };
    }
  }

  formatDate(value: string | Date, locale: string): FormattedDate {
    try {
      const date = value instanceof Date ? value : new Date(value);
      const raw = value instanceof Date ? value.toISOString() : String(value);
      if (isNaN(date.getTime())) return { raw, display: raw };
      const display = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date);
      return { raw: date.toISOString(), display };
    } catch {
      const raw = String(value);
      return { raw, display: raw };
    }
  }

  /**
   * Recursively walks a plain object/array and replaces known numeric/date
   * fields with `{ raw, display }` pairs. Non-matching fields are left as-is.
   */
  localizeResponse(data: unknown, locale: string, currency?: string): unknown {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) {
      return data.map((item) => this.localizeResponse(item, locale, currency));
    }
    if (data instanceof Date) return this.formatDate(data, locale);
    if (typeof data !== 'object') return data;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (typeof value === 'number' && CURRENCY_FIELDS.has(key)) {
        result[key] = this.formatCurrency(value, locale, currency);
      } else if (typeof value === 'number' && PERCENT_FIELDS.has(key)) {
        result[key] = this.formatPercent(value, locale);
      } else if (
        DATE_FIELDS.has(key) &&
        (typeof value === 'string' || value instanceof Date)
      ) {
        result[key] = this.formatDate(value as string | Date, locale);
      } else if (value !== null && typeof value === 'object') {
        result[key] = this.localizeResponse(value, locale, currency);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
