import { AuditLog } from '../../entities/audit-log.entity';
import { sanitizeAndEscapeCsvCell } from '../../../common/utils/csv-sanitizer.util';

export function formatAuditLogCsv(logs: AuditLog[]): string {
  if (logs.length === 0) return '';
  const headers = ['id', 'userId', 'action', 'resource', 'resourceId', 'ipAddress', 'status', 'createdAt'].join(',');
  const rows = logs.map(l => [
    sanitizeAndEscapeCsvCell(l.id),
    sanitizeAndEscapeCsvCell(l.userId || ''),
    sanitizeAndEscapeCsvCell(l.action),
    sanitizeAndEscapeCsvCell(l.resource || ''),
    sanitizeAndEscapeCsvCell(l.resourceId || ''),
    sanitizeAndEscapeCsvCell(l.ipAddress || ''),
    sanitizeAndEscapeCsvCell(l.status),
    sanitizeAndEscapeCsvCell(l.createdAt.toISOString()),
  ].join(',')).join('\n');
  return `${headers}\n${rows}`;
}
