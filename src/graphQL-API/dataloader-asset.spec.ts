import DataLoader from 'dataloader';
import { createDataLoader } from './dataloader-factory';

describe('Asset DataLoader', () => {
  it('batches multiple loads into a single batch call', async () => {
    const batchFn = jest.fn(async (keys: readonly string[]) => {
      // return dummy assets matching codes
      return (keys as string[]).map((k) => ({ code: k, id: `id-${k}` }));
    });

    const loader = createDataLoader<string, any>(batchFn, (a) => a.code);

    // Simulate N positions requesting asset metadata
    const codes = ['XLM', 'USDC', 'AQUA', 'XLM'];

    const promises = codes.map((c) => loader.load(c));
    const results = await Promise.all(promises);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(results.length).toBe(codes.length);
    expect(results[0].code).toBe('XLM');
  });
});
