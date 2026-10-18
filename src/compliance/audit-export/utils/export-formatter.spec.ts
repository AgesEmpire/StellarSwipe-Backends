import { formatAuditExport } from './export-formatter';
import { AuditLog, AuditAction, AuditStatus } from '../../../../audit-log/entities/audit-log.entity';
import { AuditExportFormat } from '../dto/export-request.dto';

describe('formatAuditExport', () => {
  it('neutralizes formula injection characters in CSV export', () => {
    const maliciousLogs = [
      {
        id: '=CMD|/C calc!A0',
        userId: '+1234567890',
        action: AuditAction.TRADE_EXECUTED,
        resource: '@resource',
        resourceId: '-9999',
        status: AuditStatus.SUCCESS,
        ipAddress: '  =1+1',
        userAgent: 'Mozilla',
        errorMessage: '=HYPERLINK("http://evil.com","Click")',
        sessionId: 'sess-1',
        requestId: 'req-1',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      } as unknown as AuditLog,
    ];

    const result = formatAuditExport(maliciousLogs, AuditExportFormat.CSV);
    expect(result.mimeType).toBe('text/csv');
    expect(result.extension).toBe('csv');

    const lines = result.content.split('\n');
    expect(lines.length).toBe(2);

    const dataRow = lines[1];
    // id should have leading quote
    expect(dataRow).toContain("'=CMD|/C calc!A0");
    // userId starting with +
    expect(dataRow).toContain("'+1234567890");
    // resource starting with @
    expect(dataRow).toContain("'@resource");
    // resourceId starting with -
    expect(dataRow).toContain("'-9999");
    // ipAddress with leading whitespace and =
    expect(dataRow).toContain("'=1+1");
  });

  it('preserves clean values in CSV export', () => {
    const cleanLogs = [
      {
        id: 'clean-1',
        userId: 'user-1',
        action: AuditAction.LOGIN,
        resource: 'auth',
        resourceId: 'res-1',
        status: AuditStatus.SUCCESS,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        errorMessage: '',
        sessionId: 'sess-1',
        requestId: 'req-1',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      } as unknown as AuditLog,
    ];

    const result = formatAuditExport(cleanLogs, AuditExportFormat.CSV);
    const lines = result.content.split('\n');
    expect(lines[1]).toContain('clean-1,user-1,LOGIN,auth,res-1,SUCCESS,127.0.0.1');
  });
});
