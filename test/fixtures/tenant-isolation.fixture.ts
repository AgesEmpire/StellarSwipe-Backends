/**
 * Fixtures for the tenant-isolation integration suite.
 *
 * `TenantRecord` is a minimal tenant-owned table and `TenantRecordService` is
 * a representative tenant-scoped service built only from the public tenancy
 * primitives (TenantScopedQueryHelper for reads, TenantScopingService for
 * write predicates and ownership checks) — the same way a feature module is
 * expected to use them.
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Repository,
} from 'typeorm';
import { TenantScopingService } from '../../src/tenancy/tenant-scoping.service';
import { TenantScopedQueryHelper } from '../../src/tenancy/helpers/tenant-scoped-query.helper';

export const TENANT_A = '00000000-0000-4000-8000-00000000000a';
export const TENANT_B = '00000000-0000-4000-8000-00000000000b';

@Entity('tenant_isolation_records')
export class TenantRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Property name matches TENANT_COLUMN so scopeFindOptions() applies as-is.
  @Column({ type: 'uuid' })
  tenant_id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'int', default: 0 })
  balance!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

export class TenantRecordService {
  constructor(
    private readonly repo: Repository<TenantRecord>,
    private readonly queryHelper: TenantScopedQueryHelper,
    private readonly scoping: TenantScopingService,
  ) {}

  async findById(id: string): Promise<TenantRecord | undefined> {
    return this.queryHelper.findById(this.repo, 'record', id);
  }

  async findByName(name: string): Promise<TenantRecord[]> {
    return this.queryHelper.findByCondition(this.repo, 'record', { name });
  }

  async list(): Promise<TenantRecord[]> {
    return this.queryHelper
      .createQueryBuilder(this.repo, 'record')
      .orderBy('record.name', 'ASC')
      .getMany();
  }

  /** Exercises OR branches, the classic way a tenant predicate leaks. */
  async search(nameA: string, nameB: string): Promise<TenantRecord[]> {
    return this.queryHelper
      .createQueryBuilder(this.repo, 'record')
      .where('record.name = :nameA', { nameA })
      .orWhere('record.name = :nameB', { nameB })
      .getMany();
  }

  async count(): Promise<number> {
    return this.queryHelper.countByCondition(this.repo, 'record');
  }

  async create(name: string, balance = 0): Promise<TenantRecord> {
    return this.repo.save(
      this.repo.create({
        name,
        balance,
        tenant_id: this.scoping.getActiveTenantId(),
      }),
    );
  }

  /** Scoped bulk write — returns affected rows. */
  async updateBalance(id: string, balance: number): Promise<number> {
    const result = await this.repo.update(
      this.scoping.scopeFindOptions<TenantRecord>({ id }) as object,
      { balance },
    );
    return result.affected ?? 0;
  }

  async remove(id: string): Promise<number> {
    const result = await this.repo.delete(
      this.scoping.scopeFindOptions<TenantRecord>({ id }) as object,
    );
    return result.affected ?? 0;
  }

  /** Load-check-save write path guarded by an explicit ownership assertion. */
  async rename(id: string, name: string): Promise<TenantRecord> {
    const record = await this.repo.findOneByOrFail({ id });
    this.scoping.assertTenantOwnership(record.tenant_id, 'record');
    record.name = name;
    return this.repo.save(record);
  }
}

export const tenantRecordSeed = (): Array<Partial<TenantRecord>> => [
  { tenant_id: TENANT_A, name: 'alpha-1', balance: 100 },
  { tenant_id: TENANT_A, name: 'alpha-2', balance: 200 },
  { tenant_id: TENANT_B, name: 'bravo-1', balance: 300 },
  { tenant_id: TENANT_B, name: 'bravo-2', balance: 400 },
  // Same name in both tenants: name-based lookups must not cross over.
  { tenant_id: TENANT_A, name: 'shared-name', balance: 1 },
  { tenant_id: TENANT_B, name: 'shared-name', balance: 2 },
];
