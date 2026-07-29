# TenantScopedQueryHelper Reference Implementation

The `TenantScopedQueryHelper` enforces tenant isolation by automatically injecting tenant-scoping predicates into all queries. This ensures that ad-hoc query builder usage cannot bypass tenant scoping.

## Pattern

All queries on tenant-scoped entities must use the `TenantScopedQueryHelper` to create query builders. The tenant scope is applied automatically and cannot be overridden.

## Before (Unsafe - can bypass tenant scoping)

```typescript
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  async findOrdersByUser(userId: string): Promise<Order[]> {
    // WARNING: Developer may forget to manually apply tenant scoping here
    const qb = this.orderRepository.createQueryBuilder('order');
    // If tenant scoping is forgotten, this query could return orders from other tenants
    return qb
      .where('order.userId = :userId', { userId })
      .getMany();
  }

  async findExpiredOrders(): Promise<Order[]> {
    // Unsafe: no tenant scoping applied
    return this.orderRepository.find({
      where: { status: 'expired' },
    });
  }
}
```

## After (Safe - tenant scoping enforced)

```typescript
import { TenantScopedQueryHelper } from '../helpers/tenant-scoped-query.helper';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly queryScopeHelper: TenantScopedQueryHelper,
  ) {}

  async findOrdersByUser(userId: string): Promise<Order[]> {
    // Tenant scoping is automatically applied and cannot be bypassed
    return this.queryScopeHelper
      .createQueryBuilder(this.orderRepository, 'order')
      .where('order.userId = :userId', { userId })
      .getMany();
  }

  async findExpiredOrders(): Promise<Order[]> {
    // Using the convenience helper method
    return this.queryScopeHelper.findByCondition(
      this.orderRepository,
      'order',
      { status: 'expired' },
    );
  }

  async findOrderWithRelations(orderId: string): Promise<Order | undefined> {
    return this.queryScopeHelper
      .createQueryBuilder(this.orderRepository, 'order')
      .leftJoinAndSelect('order.items', 'item')
      .leftJoinAndSelect('order.customer', 'customer')
      .where('order.id = :orderId', { orderId })
      .getOne();
  }

  async countActiveOrdersForUser(userId: string): Promise<number> {
    return this.queryScopeHelper.countByCondition(
      this.orderRepository,
      'order',
      { userId, status: 'active' },
    );
  }
}
```

## API

### `createQueryBuilder(repository, alias): TenantScopedQueryBuilder`

Creates a new tenant-scoped query builder. The active tenant's predicate is automatically injected.

**Example:**
```typescript
const orders = await this.queryScopeHelper
  .createQueryBuilder(this.orderRepository, 'order')
  .where('order.status = :status', { status: 'pending' })
  .orderBy('order.createdAt', 'DESC')
  .getMany();
```

### `wrapQueryBuilder(qb): TenantScopedQueryBuilder`

Wraps an existing SelectQueryBuilder with tenant-scoping enforcement.

**Example:**
```typescript
const existingQb = this.orderRepository.createQueryBuilder('order');
const scopedQb = this.queryScopeHelper.wrapQueryBuilder(existingQb);
```

### `findByCondition(repository, alias, where): Promise<T[]>`

Convenience method to find entities matching a condition. Returns all matching entities for the active tenant.

**Example:**
```typescript
const orders = await this.queryScopeHelper.findByCondition(
  this.orderRepository,
  'order',
  { userId: '123', status: 'completed' },
);
```

### `findById(repository, alias, id): Promise<T | undefined>`

Convenience method to find a single entity by ID, scoped to the active tenant.

**Example:**
```typescript
const order = await this.queryScopeHelper.findById(
  this.orderRepository,
  'order',
  '456',
);
```

### `countByCondition(repository, alias, where?): Promise<number>`

Convenience method to count entities matching a condition.

**Example:**
```typescript
const count = await this.queryScopeHelper.countByCondition(
  this.orderRepository,
  'order',
  { status: 'pending' },
);
```

## Supported QueryBuilder Methods

The `TenantScopedQueryBuilder` supports all common query builder methods:

- **Filtering:** `where()`, `andWhere()`, `orWhere()`
- **Sorting:** `orderBy()`, `addOrderBy()`
- **Pagination:** `limit()`, `offset()`, `skip()`, `take()`
- **Joins:** `leftJoinAndSelect()`, `innerJoinAndSelect()`
- **Selection:** `select()`, `addSelect()`
- **Execution:** `getOne()`, `getMany()`, `getCount()`, `getManyAndCount()`, `getRawOne()`, `getRawMany()`

## Tenant Scoping is Automatic

The tenant scope is applied at initialization and cannot be removed or overridden:

```typescript
// This query automatically includes:
// WHERE active_tenant.tenant_id = :__tenantId AND ...
const qb = this.queryScopeHelper.createQueryBuilder(repo, 'user');
qb.where('user.email = :email', { email: 'test@example.com' });
// Tenant scoping is present — no data from other tenants can leak
```

## Error Handling

If no tenant context is active, `getCurrentTenantId()` will throw an error:

```typescript
// Error: No tenant context found. Ensure TenantMiddleware is applied.
```

This fails-fast behavior is intentional — it's better to error loudly than silently return all rows from all tenants.

## Advanced: Accessing the Inner QueryBuilder

For advanced use cases, you can access the underlying SelectQueryBuilder:

```typescript
const qb = this.queryScopeHelper.createQueryBuilder(repo, 'user');
const inner = qb.getQueryBuilder(); // Returns the inner SelectQueryBuilder
// Note: Tenant scoping has already been applied and cannot be removed
```

## Testing

When writing tests, ensure your test context sets up the tenant context properly:

```typescript
import { tenantContextStorage } from '../tenant-context';

it('should find orders for active tenant', async () => {
  const context = { tenantId: 'tenant-123' };
  return tenantContextStorage.run(context, async () => {
    const orders = await orderService.findActiveOrders();
    expect(orders).toHaveLength(2);
  });
});
```
