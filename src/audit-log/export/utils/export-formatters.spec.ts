import { formatAuditLogCsv } from './export-formatters';
import { AuditLog } from '../../entities/audit-log.entity';

describe('formatAuditLogCsv', () => {
  it('returns empty string when logs array is empty', () => {
    expect(formatAuditLogCsv([])).toBe('');
  });

  it('neutralizes spreadsheet formula prefixes in audit log csv export', () => {
    const logs = [
      {
        id: '=CMD|/C calc!A0',
        userId: '+123456789',
        action: '@transfer',
        resource: '-private-wallet',
        resourceId: '   =sum(1,2)',
        ipAddress: '10.0.0.1',
        status: 'SUCCESS',
        createdAt: new Date('2024-03-01T12:00:00.000Z'),
      } as AuditLog,
    ];

    const csv = formatAuditLogCsv(logs);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('id,userId,action,resource,resourceId,ipAddress,status,createdAt');

    const row = lines[1];
    expect(row).toContain("'=CMD|/C calc!A0");
    expect(row).toContain("'+123456789");
    expect(row).toContain("'@transfer");
    expect(row).toContain("'-private-wallet");
    expect(row).toContain("'=sum(1,2)");
  });

  it('preserves clean audit log values', () => {
    const logs = [
      {
        id: 'log-100',
        userId: 'usr-42',
        action: 'UPDATE_PROFILE',
        resource: 'user',
        resourceId: 'usr-42',
        ipAddress: '192.168.0.1',
        status: 'SUCCESS',
        createdAt: new Date('2024-03-01T12:00:00.000Z'),
      } as AuditLog,
    ];

    const csv = formatAuditLogCsv(logs);
    expect(csv).toContain('log-100,usr-42,UPDATE_PROFILE,user,usr-42,192.168.0.1,SUCCESS,2024-03-01T12:00:00.000Z');
  });
});
