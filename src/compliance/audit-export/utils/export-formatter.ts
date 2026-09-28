import { AuditLog } from '../../../audit-log/entities/audit-log.entity';
import { AuditExportFormat } from '../dto/export-request.dto';

export interface FormattedExport {
  content: string;
  mimeType: string;
  extension: string;
}

/**
 * Formats audit log data into the requested export format.
 */
export function formatAuditExport(
  logs: AuditLog[],
  format: AuditExportFormat,
): FormattedExport {
  switch (format) {
    case AuditExportFormat.CSV:
      return formatAsCsv(logs);
    case AuditExportFormat.JSON:
      return formatAsJson(logs);
    case AuditExportFormat.PDF:
      return formatAsPdf(logs);
    default:
      return formatAsCsv(logs);
  }
}

function formatAsCsv(logs: AuditLog[]): FormattedExport {
  const headers = [
    'ID',
    'User ID',
    'Action',
    'Resource',
    'Resource ID',
    'Status',
    'IP Address',
    'User Agent',
    'Error Message',
    'Session ID',
    'Request ID',
    'Created At',
  ];

  const rows = logs.map((log) => [
    escapeCsv(log.id),
    escapeCsv(log.userId ?? ''),
    escapeCsv(log.action),
    escapeCsv(log.resource ?? ''),
    escapeCsv(log.resourceId ?? ''),
    escapeCsv(log.status ?? ''),
    escapeCsv(log.ipAddress ?? ''),
    escapeCsv(log.userAgent ?? ''),
    escapeCsv(log.errorMessage ?? ''),
    escapeCsv(log.sessionId ?? ''),
    escapeCsv(log.requestId ?? ''),
    escapeCsv(log.createdAt?.toISOString() ?? ''),
  ]);

  const content = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  return {
    content,
    mimeType: 'text/csv',
    extension: 'csv',
  };
}

function formatAsJson(logs: AuditLog[]): FormattedExport {
  const sanitized = logs.map((log) => ({
    id: log.id,
    userId: log.userId,
    action: log.action,
    resource: log.resource,
    resourceId: log.resourceId,
    status: log.status,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    errorMessage: log.errorMessage,
    sessionId: log.sessionId,
    requestId: log.requestId,
    createdAt: log.createdAt?.toISOString(),
    metadata: log.metadata,
  }));

  const content = JSON.stringify(sanitized, null, 2);

  return {
    content,
    mimeType: 'application/json',
    extension: 'json',
  };
}

function formatAsPdf(logs: AuditLog[]): FormattedExport {
  // For PDF generation, in production use a PDF library (e.g., pdfkit, puppeteer)
  // This implementation returns a simple HTML table as a placeholder that can be
  // rendered to PDF by a downstream service or converter.
  const rows = logs
    .map(
      (log) => `
    <tr>
      <td>${escapeHtml(log.id)}</td>
      <td>${escapeHtml(log.userId ?? '')}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.resource ?? '')}</td>
      <td>${escapeHtml(log.status ?? '')}</td>
      <td>${escapeHtml(log.ipAddress ?? '')}</td>
      <td>${log.createdAt?.toISOString() ?? ''}</td>
    </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Audit Export</title>
<style>
  body { font-family: Arial, sans-serif; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background-color: #f2f2f2; }
</style></head><body>
<h1>Audit Trail Export</h1>
<p>Generated: ${new Date().toISOString()}</p>
<p>Total Records: ${logs.length}</p>
<table>
<thead><tr>
  <th>ID</th><th>User ID</th><th>Action</th><th>Resource</th><th>Status</th><th>IP</th><th>Date</th>
</tr></thead>
<tbody>${rows}</tbody>
</table></body></html>`;

  return {
    content: html,
    mimeType: 'text/html',
    extension: 'html',
  };
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
