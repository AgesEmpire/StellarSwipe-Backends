import { Injectable, Logger } from '@nestjs/common';
import { RegionCode } from '../entities/data-region.entity';

const COUNTRY_TO_REGION: Record<string, RegionCode> = {
  // EU / EEA
  AT: RegionCode.EU, BE: RegionCode.EU, BG: RegionCode.EU, CY: RegionCode.EU,
  CZ: RegionCode.EU, DE: RegionCode.EU, DK: RegionCode.EU, EE: RegionCode.EU,
  ES: RegionCode.EU, FI: RegionCode.EU, FR: RegionCode.EU, GR: RegionCode.EU,
  HR: RegionCode.EU, HU: RegionCode.EU, IE: RegionCode.EU, IT: RegionCode.EU,
  LT: RegionCode.EU, LU: RegionCode.EU, LV: RegionCode.EU, MT: RegionCode.EU,
  NL: RegionCode.EU, PL: RegionCode.EU, PT: RegionCode.EU, RO: RegionCode.EU,
  SE: RegionCode.EU, SI: RegionCode.EU, SK: RegionCode.EU, IS: RegionCode.EU,
  LI: RegionCode.EU, NO: RegionCode.EU, CH: RegionCode.EU, GB: RegionCode.EU,

  // US / North America
  US: RegionCode.US, CA: RegionCode.US, MX: RegionCode.US,
  PR: RegionCode.US, GU: RegionCode.US, VI: RegionCode.US,

  // Asia-Pacific
  CN: RegionCode.ASIA, JP: RegionCode.ASIA, KR: RegionCode.ASIA,
  SG: RegionCode.ASIA, IN: RegionCode.ASIA, TH: RegionCode.ASIA,
  MY: RegionCode.ASIA, PH: RegionCode.ASIA, ID: RegionCode.ASIA,
  VN: RegionCode.ASIA, TW: RegionCode.ASIA, HK: RegionCode.ASIA,
  MO: RegionCode.ASIA, AU: RegionCode.ASIA, NZ: RegionCode.ASIA,
  BD: RegionCode.ASIA, PK: RegionCode.ASIA, LK: RegionCode.ASIA,

  // Latin America
  BR: RegionCode.LATAM, AR: RegionCode.LATAM, CL: RegionCode.LATAM,
  CO: RegionCode.LATAM, PE: RegionCode.LATAM, VE: RegionCode.LATAM,
  EC: RegionCode.LATAM, UY: RegionCode.LATAM, PY: RegionCode.LATAM,
  BO: RegionCode.LATAM,
};

@Injectable()
export class RegionDetector {
  private readonly logger = new Logger(RegionDetector.name);

  detectRegionByCountry(countryCode: string): RegionCode {
    const region = COUNTRY_TO_REGION[countryCode.toUpperCase()];
    if (!region) {
      this.logger.debug(`No region mapping for country ${countryCode}, defaulting to US`);
      return RegionCode.US;
    }
    return region;
  }

  detectRegionByIp(ipAddress: string): RegionCode {
    // In production this delegates to a GeoIP service; here we return a safe default.
    // IP-based detection requires an external GeoIP database (e.g., MaxMind GeoIP2).
    this.logger.debug(`IP-based region detection requested for ${ipAddress}`);
    return RegionCode.US;
  }

  detectRegionByTimezone(timezone: string): RegionCode {
    if (timezone.startsWith('Europe/')) return RegionCode.EU;
    if (timezone.startsWith('America/')) return RegionCode.US;
    if (
      timezone.startsWith('Asia/') ||
      timezone.startsWith('Pacific/') ||
      timezone.startsWith('Australia/')
    ) {
      return RegionCode.ASIA;
    }
    return RegionCode.US;
  }

  isRegionValid(regionCode: string): regionCode is RegionCode {
    return Object.values(RegionCode).includes(regionCode as RegionCode);
  }

  getCountriesForRegion(region: RegionCode): string[] {
    return Object.entries(COUNTRY_TO_REGION)
      .filter(([, r]) => r === region)
      .map(([country]) => country);
  }
}
