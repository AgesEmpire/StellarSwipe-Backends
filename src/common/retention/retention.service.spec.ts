import { RetentionService } from './retention.service';
import { RetentionPolicy } from './retention-policy.interface';

class FakeEntity {}

describe('RetentionService', () => {
  const buildQb = (affected: number) => {
    const qb: any = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected }),
    };
    return qb;
  };

  const buildService = (qb: any) => {
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      }),
    } as any;
    return new RetentionService(dataSource);
  };

  const policy: RetentionPolicy = {
    name: 'test-policy',
    entity: FakeEntity,
    dateProperty: 'createdAt',
    retentionDays: 30,
  };

  it('registers and lists policies', () => {
    const service = buildService(buildQb(0));
    service.registerPolicy(policy);
    expect(service.getPolicies()).toEqual([policy]);
  });

  it('deletes records older than the cutoff and reports the count', async () => {
    const qb = buildQb(7);
    const service = buildService(qb);

    const result = await service.runPolicy(policy);

    expect(qb.where).toHaveBeenCalledWith('record.createdAt < :cutoff', { cutoff: expect.any(Date) });
    expect(result).toEqual({ policy: 'test-policy', deleted: 7 });
  });

  it('applies an extra predicate when the policy defines one', async () => {
    const qb = buildQb(3);
    const service = buildService(qb);

    await service.runPolicy({
      ...policy,
      extraWhere: 'record.status = :status',
      extraParams: { status: 'published' },
    });

    expect(qb.andWhere).toHaveBeenCalledWith('record.status = :status', { status: 'published' });
  });

  it('captures errors per-policy instead of throwing, so one bad policy does not block others', async () => {
    const qb = buildQb(0);
    qb.execute.mockRejectedValue(new Error('db down'));
    const service = buildService(qb);

    const result = await service.runPolicy(policy);

    expect(result).toEqual({ policy: 'test-policy', deleted: 0, error: 'db down' });
  });

  it('runAll executes every registered policy', async () => {
    const qb = buildQb(1);
    const service = buildService(qb);
    service.registerPolicy(policy);
    service.registerPolicy({ ...policy, name: 'second-policy' });

    const results = await service.runAll();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.policy)).toEqual(['test-policy', 'second-policy']);
  });
});
