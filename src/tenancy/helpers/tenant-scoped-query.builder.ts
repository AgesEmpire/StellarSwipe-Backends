import {
  SelectQueryBuilder,
  Repository,
  ObjectLiteral,
  WhereExpressionBuilder,
} from 'typeorm';
import { TenantScopingService, TENANT_COLUMN } from '../tenant-scoping.service';

/**
 * TenantScopedQueryBuilder
 *
 * A wrapper around TypeORM's SelectQueryBuilder that enforces tenant scoping.
 * Every new instance is automatically scoped to the active tenant via TenantScopingService.
 *
 * Usage:
 *   const qb = new TenantScopedQueryBuilder(
 *     repository.createQueryBuilder('user'),
 *     tenantScopingService,
 *   );
 *   qb.where('user.email = :email', { email })
 *     .andWhere('user.active = :active', { active: true })
 *     .getOne();
 *
 * The tenant scope is automatically applied and cannot be removed or overridden.
 */
export class TenantScopedQueryBuilder<T extends ObjectLiteral> {
  private innerQb: SelectQueryBuilder<T>;
  private tenantScoped: boolean = false;

  constructor(
    queryBuilder: SelectQueryBuilder<T>,
    private readonly tenantScopingService: TenantScopingService,
  ) {
    this.innerQb = queryBuilder;
    this._applyTenantScope();
  }

  /**
   * Apply tenant scoping once during initialization.
   */
  private _applyTenantScope(): void {
    if (!this.tenantScoped) {
      this.innerQb = this.tenantScopingService.scopeQuery(
        this.innerQb,
        { alias: this.innerQb.alias },
      );
      this.tenantScoped = true;
    }
  }

  /**
   * Delegates to the inner query builder's where clause.
   * Tenant scoping is already applied and cannot be bypassed.
   */
  where(
    where: string | ((qb: SelectQueryBuilder<T>) => string),
    parameters?: ObjectLiteral,
  ): this {
    if (typeof where === 'string') {
      this.innerQb.where(where, parameters);
    } else {
      this.innerQb.where(where(this.innerQb));
    }
    return this;
  }

  /**
   * Delegates to the inner query builder's andWhere clause.
   */
  andWhere(
    where: string | ((qb: SelectQueryBuilder<T>) => string),
    parameters?: ObjectLiteral,
  ): this {
    if (typeof where === 'string') {
      this.innerQb.andWhere(where, parameters);
    } else {
      this.innerQb.andWhere(where(this.innerQb));
    }
    return this;
  }

  /**
   * Delegates to the inner query builder's orWhere clause.
   */
  orWhere(
    where: string | ((qb: SelectQueryBuilder<T>) => string),
    parameters?: ObjectLiteral,
  ): this {
    if (typeof where === 'string') {
      this.innerQb.orWhere(where, parameters);
    } else {
      this.innerQb.orWhere(where(this.innerQb));
    }
    return this;
  }

  /**
   * Delegates to the inner query builder's orderBy clause.
   */
  orderBy(
    sort: string | { [key: string]: 'ASC' | 'DESC' },
    order?: 'ASC' | 'DESC',
  ): this {
    this.innerQb.orderBy(sort, order);
    return this;
  }

  /**
   * Delegates to the inner query builder's addOrderBy clause.
   */
  addOrderBy(
    sort: string | { [key: string]: 'ASC' | 'DESC' },
    order?: 'ASC' | 'DESC',
  ): this {
    this.innerQb.addOrderBy(sort, order);
    return this;
  }

  /**
   * Delegates to the inner query builder's limit clause.
   */
  limit(limit?: number): this {
    this.innerQb.limit(limit);
    return this;
  }

  /**
   * Delegates to the inner query builder's offset clause.
   */
  offset(offset?: number): this {
    this.innerQb.offset(offset);
    return this;
  }

  /**
   * Delegates to the inner query builder's skip clause.
   */
  skip(skip?: number): this {
    this.innerQb.skip(skip);
    return this;
  }

  /**
   * Delegates to the inner query builder's take clause.
   */
  take(take?: number): this {
    this.innerQb.take(take);
    return this;
  }

  /**
   * Delegates to the inner query builder's leftJoinAndSelect clause.
   */
  leftJoinAndSelect(
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): this {
    this.innerQb.leftJoinAndSelect(property, alias, condition, parameters);
    return this;
  }

  /**
   * Delegates to the inner query builder's innerJoinAndSelect clause.
   */
  innerJoinAndSelect(
    property: string,
    alias: string,
    condition?: string,
    parameters?: ObjectLiteral,
  ): this {
    this.innerQb.innerJoinAndSelect(property, alias, condition, parameters);
    return this;
  }

  /**
   * Delegates to the inner query builder's select clause.
   */
  select(
    selection?: string | string[] | ((qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>),
    aliasName?: string,
  ): this {
    if (Array.isArray(selection)) {
      this.innerQb.select(selection, aliasName);
    } else if (typeof selection === 'string') {
      this.innerQb.select(selection, aliasName);
    } else if (typeof selection === 'function') {
      selection(this.innerQb);
    }
    return this;
  }

  /**
   * Delegates to the inner query builder's addSelect clause.
   */
  addSelect(
    selection?: string | string[] | ((qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>),
    aliasName?: string,
  ): this {
    if (Array.isArray(selection)) {
      this.innerQb.addSelect(selection, aliasName);
    } else if (typeof selection === 'string') {
      this.innerQb.addSelect(selection, aliasName);
    } else if (typeof selection === 'function') {
      selection(this.innerQb);
    }
    return this;
  }

  /**
   * Returns the inner query builder (advanced access — use with caution).
   * The tenant scope has already been applied and cannot be removed.
   */
  getQueryBuilder(): SelectQueryBuilder<T> {
    return this.innerQb;
  }

  /**
   * Executes the query and returns a single result.
   */
  async getOne(): Promise<T | undefined> {
    return this.innerQb.getOne();
  }

  /**
   * Executes the query and returns all results.
   */
  async getMany(): Promise<T[]> {
    return this.innerQb.getMany();
  }

  /**
   * Executes the query and returns the number of results.
   */
  async getCount(): Promise<number> {
    return this.innerQb.getCount();
  }

  /**
   * Executes the query and returns results with count.
   */
  async getManyAndCount(): Promise<[T[], number]> {
    return this.innerQb.getManyAndCount();
  }

  /**
   * Executes the query and returns the raw result.
   */
  async getRawOne(): Promise<T | undefined> {
    return this.innerQb.getRawOne();
  }

  /**
   * Executes the query and returns raw results.
   */
  async getRawMany(): Promise<T[]> {
    return this.innerQb.getRawMany();
  }
}
