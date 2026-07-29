import { Injectable } from '@nestjs/common';

const COUNTRY_TO_MACRO_REGION: Record<string, string> = {
  US: 'NA', CA: 'NA', MX: 'LATAM',
  BR: 'LATAM', AR: 'LATAM', CO: 'LATAM', CL: 'LATAM',
  GB: 'EU', DE: 'EU', FR: 'EU', ES: 'EU', IT: 'EU',
  NL: 'EU', PL: 'EU', SE: 'EU', NO: 'EU', DK: 'EU',
  JP: 'APAC', CN: 'APAC', AU: 'APAC', SG: 'APAC',
  KR: 'APAC', IN: 'APAC', TH: 'APAC', VN: 'APAC',
  ZA: 'AF', NG: 'AF', KE: 'AF', GH: 'AF', EG: 'AF',
  AE: 'MEA', SA: 'MEA', IL: 'MEA', TR: 'MEA',
};

@Injectable()
export class RegionResolver {
  resolveFromCountry(countryCode: string): string {
    return COUNTRY_TO_MACRO_REGION[countryCode.toUpperCase()] ?? countryCode.toUpperCase();
  }

  resolveFromRequest(req: Record<string, any>): string {
    const country =
      (req.headers?.['cf-ipcountry'] as string) ||
      (req.headers?.['x-country-code'] as string) ||
      (req.headers?.['x-geoip-country'] as string);

    if (country && country !== 'XX') return this.resolveFromCountry(country);

    const userRegion = req.user?.region as string | undefined;
    if (userRegion) return userRegion.toUpperCase();

    return 'GLOBAL';
  }

  getRegionHierarchy(region: string): string[] {
    const hierarchy: string[] = [region];
    const parent = COUNTRY_TO_MACRO_REGION[region];
    if (parent && parent !== region) hierarchy.push(parent);
    if (region !== 'GLOBAL') hierarchy.push('GLOBAL');
    return [...new Set(hierarchy)];
  }
}
