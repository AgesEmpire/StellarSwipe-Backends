import { Injectable } from '@nestjs/common';
import { Repository, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { TenantScopingService } from '../tenant-scoping.service';
import { TenantScopedQueryBuilder } from './tenant-scoped-query.builder';

/**
 * TenantScopedQueryHelper
 *
 * Provides factory methods and convenience helpers for creating
 * tenant-scoped queries that automatically enforce tenant isolation.
 *
 * All queries created through this helper are guaranteed to include
 * the active tenant's isolation predicate.
 *
 * Usage:
 *   constructor(
 *     private readonly queryHelper: TenantScopedQueryHelper,
 *     private readonly userRepo: Repository<User>,
 *   ) {}
 *
 *   async findActiveUsers() {
 *     return this.queryHelper
 *       .createQueryBuilder(this.userRepo, 'user')
 *       .where('user.isActive = :isActive', { isActive: true })
 *       .getMany();
 *   }
 */
@Injectable()
export class TenantScopedQueryHelper {
  constructor(
    private readonly tenantScopingService: TenantScopingService,
  ) {}

  /**
   * Creates a TenantScopedQueryBuilder for the given repository and alias.
   * The resulting query builder automatically includes the active tenant's scoping predicate.
   *
   * @param repository The TypeORM repository
   * @param alias The alias for the entity in queries
   * @returns A TenantScopedQueryBuilder with tenant scoping pre-applied
   */
  createQueryBuilder<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: string,
  ): TenantScopedQueryBuilder<T> {
    const qb = repository.createQueryBuilder(alias);
    return new TenantScopedQueryBuilder(qb, this.tenantScopingService);
  }

  /**
   * Wraps an existing SelectQueryBuilder with tenant scoping enforcement.
   * Use this if you need to take an existing query builder and add tenant scoping.
   *
   * @param queryBuilder An existing SelectQueryBuilder
   * @returns A TenantScopedQueryBuilder with tenant scoping applied
   */
  wrapQueryBuilder<T extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<T>,
  ): TenantScopedQueryBuilder<T> {
    return new TenantScopedQueryBuilder(queryBuilder, this.tenantScopingService);
  }

  /**
   * Convenience method: find all entities for the active tenant matching a condition.
   *
   * @param repository The TypeORM repository
   * @param alias The alias for the entity
   * @param where Condition object to match
   * @returns Array of matching entities
   */
  async findByCondition<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: string,
    where: Partial<T>,
  ): Promise<T[]> {
    const qb = this.createQueryBuilder(repository, alias);
    const keys = Object.keys(where);
    let q = qb;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const param: any = {};
      param[key] = where[key as keyof T];
      const condition = `${alias}.${key} = :${key}`;
      q = i === 0
        ? q.where(condition, param)
        : q.andWhere(condition, param);
    }

    return q.getMany();
  }

  /**
   * Convenience method: find a single entity for the active tenant by ID.
   * Always uses tenant scoping.
   *
   * @param repository The TypeORM repository
   * @param alias The alias for the entity
   * @param id The entity ID
   * @returns The entity or undefined
   */
  async findById<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: string,
    id: any,
  ): Promise<T | undefined> {
    return this.createQueryBuilder(repository, alias)
      .where(`${alias}.id = :id`, { id })
      .getOne();
  }

  /**
   * Convenience method: count entities for the active tenant matching a condition.
   *
   * @param repository The TypeORM repository
   * @param alias The alias for the entity
   * @param where Optional condition object to match
   * @returns The count of matching entities
   */
  async countByCondition<T extends ObjectLiteral>(
    repository: Repository<T>,
    alias: string,
    where?: Partial<T>,
  ): Promise<number> {
    let qb = this.createQueryBuilder(repository, alias);

    if (where) {
      const keys = Object.keys(where);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const param: any = {};
        param[key] = where[key as keyof T];
        const condition = `${alias}.${key} = :${key}`;
        qb = i === 0
          ? qb.where(condition, param)
          : qb.andWhere(condition, param);
      }
    }

    return qb.getCount();
  }
}
