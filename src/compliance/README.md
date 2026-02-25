# Data Export and Compliance Reporting System

## Overview
Comprehensive GDPR-compliant data export and regulatory compliance reporting system for StellarSwipe.

## Features Implemented

### 1. User Data Export (GDPR Compliance)
- **Endpoint**: `POST /api/v1/compliance/export/user-data`
- **Formats**: JSON, CSV, PDF (PDF pending)
- **Includes**:
  - User profile information
  - Complete trade history
  - Signal submissions
  - Audit logs
  - Notification history
  - Settings

### 2. Compliance Reports
- **Endpoint**: `POST /api/v1/compliance/reports/generate`
- **Report Types**:
  - Trade Volume Reports
  - Financial Summaries
  - Audit Trail Reports
  - AML Risk Reports

### 3. Scheduled Reports
- **Monthly Compliance Reports**: Auto-generated on 1st of each month
- **Includes**: Trade volume, financial metrics, audit summary, AML risks

### 4. Security Features
- **Encryption**: AES-256-CBC encryption for all exports
- **Auto-deletion**: Files auto-delete after 7 days
- **Anonymization**: User data anonymized in compliance reports

## API Usage

### Export User Data
```bash
curl -X POST http://localhost:3000/api/v1/compliance/export/user-data \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "startDate": "2026-01-01",
    "endDate": "2026-02-25"
  }'
```

**Response**:
```json
{
  "message": "Export initiated successfully",
  "format": "json",
  "expiresIn": "7 days",
  "downloadUrl": "/compliance/download/user_export_123_1234567890.json"
}
```

### Generate Compliance Report
```bash
curl -X POST http://localhost:3000/api/v1/compliance/reports/generate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "trade_volume",
    "startDate": "2026-01-01",
    "endDate": "2026-01-31",
    "includeAnonymized": true
  }'
```

**Response**:
```json
{
  "reportType": "trade_volume",
  "period": {
    "startDate": "2026-01-01",
    "endDate": "2026-01-31"
  },
  "data": {
    "period": "2026-01-01 to 2026-01-31",
    "totalTrades": 15234,
    "totalVolume": 5234567.89,
    "uniqueUsers": 2145,
    "topAssets": [
      { "asset": "USDC/XLM", "volume": 2345678 },
      { "asset": "AQUA/XLM", "volume": 1234567 }
    ],
    "generatedAt": "2026-02-25T07:00:00.000Z"
  },
  "generatedAt": "2026-02-25T07:00:00.000Z"
}
```

## Report Types

### 1. Trade Volume Report
```typescript
{
  period: string;
  totalTrades: number;
  totalVolume: number;
  uniqueUsers: number;
  topAssets: Array<{ asset: string; volume: number }>;
}
```

### 2. Financial Summary
```typescript
{
  period: string;
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  winRate: string;
  totalPnL: string;
  averagePnL: string;
}
```

### 3. Audit Trail Report
```typescript
{
  period: string;
  totalEvents: number;
  actionBreakdown: Record<string, number>;
  failedActions: number;
  suspiciousActivities: number;
  events: Array<AuditEvent>;
}
```

## Environment Variables

Add to `.env`:
```bash
# Data Export Configuration
EXPORT_DIR=/tmp/exports
ENCRYPTION_KEY=your-secure-encryption-key-here

# Compliance Settings
AUTO_DELETE_EXPORTS_DAYS=7
MONTHLY_REPORT_ENABLED=true
```

## File Structure

```
src/compliance/
├── compliance.service.ts          # Main service
├── compliance.controller.ts       # API endpoints
├── compliance.module.ts           # Module configuration
├── dto/
│   ├── export-request.dto.ts     # Export request DTO
│   └── compliance-report.dto.ts  # Report request DTO
├── exporters/
│   ├── user-data-exporter.service.ts      # User data export
│   ├── trade-report-exporter.service.ts   # Trade reports
│   └── audit-trail-exporter.service.ts    # Audit logs
└── reports/
    ├── gdpr-report.generator.ts           # GDPR compliance
    └── financial-report.generator.ts      # Financial reports
```

## GDPR Compliance

### Right to Access (Article 15)
Users can request complete data export including:
- Personal information
- Trading history
- Signal submissions
- Audit logs

### Right to Data Portability (Article 20)
Data exported in machine-readable formats (JSON, CSV)

### Data Security
- AES-256-CBC encryption
- Secure file storage
- Auto-deletion after 7 days

## Edge Cases Handled

1. **Large Data Exports (>100MB)**
   - Chunked processing
   - Streaming responses
   - Pagination support

2. **Export During Active Trading**
   - Snapshot-based exports
   - Consistent data views
   - No trading interruption

3. **Data Consistency**
   - Transaction-based queries
   - Timestamp-based filtering
   - Audit trail integrity

## Testing

```bash
# Run tests
npm test src/compliance

# Test export functionality
npm run test:e2e -- --grep "compliance export"

# Test scheduled reports
npm run test:e2e -- --grep "monthly reports"
```

## Monitoring

The system logs:
- Export requests
- Report generation
- File deletions
- Encryption operations
- Errors and failures

## Future Enhancements

1. **PDF Export Support**
   - Formatted reports
   - Charts and graphs
   - Professional layouts

2. **Email Delivery**
   - Send exports via email
   - Secure download links
   - Expiration notifications

3. **Advanced Anonymization**
   - Differential privacy
   - K-anonymity
   - Data masking

4. **Real-time Compliance Dashboard**
   - Live metrics
   - Alert system
   - Compliance score

## Support

For issues or questions:
- Check logs: `/var/log/stellarswipe/compliance.log`
- Review audit trail: `GET /api/v1/audit-log`
- Contact: compliance@stellarswipe.com
