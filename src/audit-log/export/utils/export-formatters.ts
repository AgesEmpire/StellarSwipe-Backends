import { AuditLog } from '../../entities/audit-log.entity';

export function formatAuditLogCsv(logs: AuditLog[]): string {
  if (logs.length === 0) return '';
  const headers = ['id', 'userId', 'action', 'resource', 'resourceId', 'ipAddress', 'status', 'createdAt'].join(',');
  const rows = logs.map(l => `${l.id},${l.userId || ''},${l.action},${l.resource || ''},${l.resourceId || ''},${l.ipAddress || ''},${l.status},${l.createdAt.toISOString()}`).join('\n');
  return `${headers}\n${rows}`;
}
