/**
 * TenantRlsSubscriber
 *
 * TypeORM subscriber that sets the PostgreSQL session variable
 * `app.tenant_id` before every query so that the RLS policy
 * `tenant_isolation_policy` can filter rows automatically.
 *
 * Resolves: #451 – Add backend support for multi-tenant database isolation
 */
import {
  EventSubscriber,
  EntitySubscriberInterface,
  QueryRunner,
} from 'typeorm';
import { getCurrentTenantIdOrNull } from './tenant-context';

@EventSubscriber()
export class TenantRlsSubscriber implements EntitySubscriberInterface {
  /**
   * Called before every query.  Sets `app.tenant_id` in the current
   * PostgreSQL session so RLS policies can reference it.
   */
  async beforeQuery(event: { queryRunner: QueryRunner }): Promise<void> {
    const tenantId = getCurrentTenantIdOrNull();
    if (tenantId && event.queryRunner?.isTransactionActive !== undefined) {
      try {
        await event.queryRunner.query(
          `SELECT set_config('app.tenant_id', $1, true)`,
          [tenantId],
        );
      } catch {
        // Non-fatal: RLS will fall back to NULL check in the policy
      }
    }
  }
}
