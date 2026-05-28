import { AssetPairMetadataService } from './asset-pair-metadata.service';

describe('AssetPairMetadataService', () => {
  let service: AssetPairMetadataService;

  beforeEach(() => {
    service = new AssetPairMetadataService();
  });

  it('returns full metadata for a known pair', () => {
    const meta = service.getMetadata('XLM', 'USDC');
    expect(meta.base).toBe('XLM');
    expect(meta.quote).toBe('USDC');
    expect(meta.displayName).toBe('Stellar / USD Coin');
    expect(meta.liquidityRating).toBe('high');
    expect(meta.iconUrl).toBeDefined();
  });

  it('is case-insensitive', () => {
    const meta = service.getMetadata('xlm', 'usdc');
    expect(meta.displayName).toBe('Stellar / USD Coin');
  });

  it('returns fallback for unknown pair', () => {
    const meta = service.getMetadata('FOO', 'BAR');
    expect(meta.base).toBe('FOO');
    expect(meta.quote).toBe('BAR');
    expect(meta.displayName).toBe('FOO / BAR');
    expect(meta.liquidityRating).toBe('unknown');
    expect(meta.iconUrl).toBeUndefined();
  });

  it('getMetadataMap returns correct entries for mixed known/unknown pairs', () => {
    const map = service.getMetadataMap([
      { base: 'XLM', quote: 'USDC' },
      { base: 'UNKNOWN', quote: 'PAIR' },
    ]);
    expect(map.get('XLM/USDC')?.liquidityRating).toBe('high');
    expect(map.get('UNKNOWN/PAIR')?.liquidityRating).toBe('unknown');
  });

  it('getMetadataMap handles empty input', () => {
    expect(service.getMetadataMap([])).toEqual(new Map());
  });
});
