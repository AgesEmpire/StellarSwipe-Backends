import { Test, TestingModule } from '@nestjs/testing';
import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of } from 'rxjs';
import { BatchLoaderService } from './batch-loader.service';

describe('BatchLoaderService', () => {
  let service: BatchLoaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BatchLoaderService],
    }).compile();
    service = module.get<BatchLoaderService>(BatchLoaderService);
  });

  it('should batch multiple load calls into a single batchFn call', async () => {
    const batchFn = jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, name: `Item ${id}` })),
    );
    const loader = service.create<string, { id: string; name: string }>(batchFn);

    const p1 = loader.load('a');
    const p2 = loader.load('b');
    const p3 = loader.load('c');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(batchFn).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(r1).toEqual({ id: 'a', name: 'Item a' });
    expect(r2).toEqual({ id: 'b', name: 'Item b' });
    expect(r3).toEqual({ id: 'c', name: 'Item c' });
  });

  it('should reject when entity not found for key', async () => {
    const batchFn = jest.fn(async (ids: string[]) =>
      ids.filter((id) => id !== 'missing').map((id) => ({ id })),
    );
    const loader = service.create(batchFn);

    const p1 = loader.load('exists');
    const p2 = loader.load('missing');

    const r1 = await p1;
    expect(r1).toEqual({ id: 'exists' });

    await expect(p2).rejects.toThrow('Entity not found for key: missing');
  });

  it('should reject all on batchFn error', async () => {
    const batchFn = jest.fn(async () => {
      throw new Error('DB connection failed');
    });
    const loader = service.create(batchFn);

    const p1 = loader.load('a');
    const p2 = loader.load('b');

    await expect(p1).rejects.toThrow('DB connection failed');
    await expect(p2).rejects.toThrow('DB connection failed');
  });

  it('should support loadMany', async () => {
    const batchFn = jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ id })),
    );
    const loader = service.create(batchFn);

    const results = await loader.loadMany(['x', 'y', 'z']);

    expect(batchFn).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
  });

  it('should use custom keyFn', async () => {
    const batchFn = jest.fn(async (ids: number[]) =>
      ids.map((id) => ({ customId: id, val: id * 10 })),
    );
    const loader = service.create<number, { customId: number; val: number }>(
      batchFn,
      (e) => e.customId,
    );

    const result = await loader.load(5);
    expect(result).toEqual({ customId: 5, val: 50 });
  });
});
