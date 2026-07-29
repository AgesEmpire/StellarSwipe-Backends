import { Injectable } from '@nestjs/common';
import { ComplianceRegion } from '../interfaces/compliance-framework.interface';

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

@Injectable()
export class RegionDetector {
  detectFromCountryCode(countryCode: string): ComplianceRegion {
    const code = countryCode.toUpperCase();
    if (EU_COUNTRY_CODES.has(code)) return ComplianceRegion.EU;
    if (code === 'US') return ComplianceRegion.US;
    if (code === 'NG') return ComplianceRegion.NG;
    return ComplianceRegion.GLOBAL;
  }

  detectFromLocale(locale: string): ComplianceRegion {
    const parts = locale.split('-');
    const countryCode = parts.length > 1 ? parts[1] : '';
    return this.detectFromCountryCode(countryCode);
  }

  getSupportedRegions(): ComplianceRegion[] {
    return [ComplianceRegion.EU, ComplianceRegion.US, ComplianceRegion.NG, ComplianceRegion.GLOBAL];
  }
}
