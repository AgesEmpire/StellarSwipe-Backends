# Support Ticketing System — NestJS

## Folder Structure

```
src/
├── app.module.ts
└── support/
    ├── support.module.ts
    └── tickets/
        ├── ticket.controller.ts
        ├── ticket.service.ts
        ├── entities/
        │   └── support-ticket.entity.ts
        └── dto/
            ├── create-ticket.dto.ts
            └── ticket-response.dto.ts
```

## Features

| Feature | Detail |
|---|---|
| Ticket creation | Auto-generates ticket number (TKT-000001), sends automated response |
| Priority levels | LOW / MEDIUM / HIGH / CRITICAL |
| SLA tracking | 72 / 24 / 4 / 1 hours respectively; `slaBreached` flag computed on every read |
| Status machine | OPEN → IN_PROGRESS → PENDING_CUSTOMER → RESOLVED → CLOSED (guarded transitions) |
| Agent dashboard | Counts by status, SLA-breached list, unassigned queue, recent tickets |
| Auto responses | Per-category canned first reply stored on the ticket |
| Notes | Internal (agent-only) or public; first public note marks `firstResponseAt` and auto-advances OPEN → IN_PROGRESS |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/support/tickets` | Create ticket |
| GET | `/support/tickets` | List/filter tickets |
| GET | `/support/tickets/:id` | Get single ticket |
| GET | `/support/tickets/dashboard/overview` | Agent dashboard |
| PATCH | `/support/tickets/:id` | Update metadata |
| PATCH | `/support/tickets/:id/status` | Change status |
| PATCH | `/support/tickets/:id/assign` | Assign to agent |
| POST | `/support/tickets/:id/notes` | Add note/reply |

## Quick Start

```bash
npm install uuid class-validator class-transformer @nestjs/common @nestjs/core reflect-metadata rxjs
```

Register `SupportModule` in your `AppModule`:

```ts
@Module({ imports: [SupportModule] })
export class AppModule {}
```

Enable validation in `main.ts`:

```ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

## Swapping the In-Memory Store

`TicketService` uses a plain `Map` — replace the `tickets` map and helper methods with your TypeORM / Prisma / Mongoose repository to persist data.
