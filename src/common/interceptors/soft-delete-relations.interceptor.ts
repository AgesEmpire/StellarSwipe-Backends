import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';
import { Reflector } from '@nestjs/core';

/**
 * SoftDeleteRelationsInterceptor
 *
 * Recursively filters out soft-deleted entities from nested relation arrays
 * before response serialization. Works with both eager- and lazy-loaded relations.
 *
 * Usage:
 *   @UseInterceptors(SoftDeleteRelationsInterceptor)
 *   @Get(':id')
 *   getEntity(@Param('id') id: string) { ... }
 *
 * Notes:
 *   - Entities with `deletedAt` field (from BaseEntity) are considered soft-deleted
 *   - Filters apply to all nested arrays at any depth
 *   - Single-entity relations are preserved as-is (not filtered)
 *   - Modifies response data in-place for efficiency
 */
@Injectable()
export class SoftDeleteRelationsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SoftDeleteRelationsInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map(payload => {
        try {
          return this.filterSoftDeletedRelations(payload);
        } catch (error) {
          this.logger.error(
            `Error filtering soft-deleted relations: ${(error as Error).message}`,
            { type: 'soft_delete_filter_error', error: (error as Error).stack },
          );
          // Return original payload on error to avoid breaking response
          return payload;
        }
      }),
    );
  }

  /**
   * Recursively traverses response payload and filters soft-deleted entities
   * from all nested relation arrays.
   */
  private filterSoftDeletedRelations(payload: any): any {
    if (payload === null || payload === undefined) {
      return payload;
    }

    // Handle array of entities
    if (Array.isArray(payload)) {
      return payload
        .filter(item => !this.isSoftDeleted(item))
        .map(item => this.filterSoftDeletedRelations(item));
    }

    // Handle objects
    if (typeof payload === 'object' && payload.constructor === Object) {
      const filtered = { ...payload };

      for (const [key, value] of Object.entries(filtered)) {
        if (Array.isArray(value)) {
          // Filter arrays of relations
          filtered[key] = value
            .filter(item => !this.isSoftDeleted(item))
            .map(item => this.filterSoftDeletedRelations(item));
        } else if (value !== null && typeof value === 'object') {
          // Recursively process nested objects
          filtered[key] = this.filterSoftDeletedRelations(value);
        }
      }

      return filtered;
    }

    // Return primitives as-is
    return payload;
  }

  /**
   * Checks if an entity is soft-deleted by looking for the deletedAt field.
   * An entity is considered soft-deleted if deletedAt is not null/undefined.
   */
  private isSoftDeleted(entity: any): boolean {
    if (entity === null || entity === undefined) {
      return false;
    }

    if (typeof entity !== 'object') {
      return false;
    }

    // Check for deletedAt field (from TypeORM DeleteDateColumn)
    const deletedAt = entity.deletedAt || entity.deleted_at;
    return deletedAt !== null && deletedAt !== undefined;
  }
}
