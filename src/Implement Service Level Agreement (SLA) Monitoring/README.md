# SLA Monitoring System

A comprehensive SLA monitoring solution built with NestJS that tracks uptime, response times, detects breaches, and generates compliance reports.

## Features

- **Uptime Tracking**: Monitor service availability with percentage calculations
- **Response Time Monitoring**: Track average, min, max, P95, and P99 response times
- **SLA Breach Detection**: Automatic detection when thresholds are exceeded
- **Automated Alerts**: Log warnings when breaches occur (extensible for incident creation)
- **Reporting Dashboard**: Generate comprehensive SLA reports and dashboard data
- **Configurable Thresholds**: Set custom SLA thresholds per service

## Installation

```bash
npm install @nestjs/typeorm @nestjs/schedule typeorm class-validator class-transformer
```

## Setup

1. Import the SlaModule in your app.module.ts:

```typescript
import { SlaModule } from "./monitoring/sla/sla.module";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      // your database config
    }),
    SlaModule,
  ],
})
export class AppModule {}
```

2. Run migrations to create the sla_metrics table

## API Endpoints

### Dashboard

```
GET /sla/dashboard?hours=24
```

Returns overview of all monitored services

### Service Report

```
GET /sla/report/:service?hours=24
```

Detailed SLA report for a specific service

### Uptime

```
GET /sla/uptime/:service?hours=24
```

Current uptime percentage

### Response Time

```
GET /sla/response-time/:service?hours=24
```

Average response time

### Breaches

```
GET /sla/breaches/:service?hours=24
```

List of SLA breaches

### Set Threshold

```
POST /sla/threshold/:service
{
  "service": "api",
  "maxResponseTime": 500,
  "minUptimePercentage": 99.9
}
```

### Manual Health Check

```
POST /sla/check/:service
```

## Usage Example

```typescript
// In your service
constructor(private slaMonitor: SlaMonitorService) {}

async performOperation() {
  const startTime = Date.now();
  try {
    await this.doWork();
    const responseTime = Date.now() - startTime;
    await this.slaMonitor.recordMetric('api', responseTime, true);
  } catch (error) {
    await this.slaMonitor.recordMetric('api', 0, false);
  }
}
```

## Automated Monitoring

The system includes a cron job that runs every minute to update uptime metrics. Extend the `handleBreach` method in `SlaMonitorService` to integrate with your incident management system.

## Configuration

Default thresholds are set in `SlaMonitorService.initializeThresholds()`. Modify or add services as needed:

```typescript
this.thresholds.set("your-service", {
  service: "your-service",
  maxResponseTime: 1000,
  minUptimePercentage: 99.5,
});
```
