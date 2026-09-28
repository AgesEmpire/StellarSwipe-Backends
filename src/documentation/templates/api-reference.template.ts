import { OpenAPIObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export function renderApiReferenceTemplate(document: OpenAPIObject): string {
  const endpointCount = Object.values(document.paths ?? {}).reduce((acc, item: any) => {
    return acc + ['get', 'post', 'put', 'patch', 'delete'].filter((m) => item[m]).length;
  }, 0);

  return `# API Reference — ${document.info.title} v${document.info.version}

> Auto-generated on ${new Date().toUTCString()}

## Overview

${document.info.description ?? ''}

- **Total Endpoints:** ${endpointCount}
- **Authentication:** Bearer JWT
- **Base URL (Production):** \`${document.servers?.[0]?.url ?? 'https://api.stellarswipe.com'}\`

## Quick Links

${(document.tags ?? []).map((t) => `- [${t.name}](#${t.name.toLowerCase().replace(/\s+/g, '-')})`).join('\n')}

## Standard Error Response

All API errors share the same response shape:

\`\`\`
{
  "statusCode": 400,
  "errorCode": "V1001",
  "message": "Validation failed",
  "path": "/api/v1/users",
  "timestamp": "2026-08-19T12:00:00.000Z",
  "requestId": "c1c0d0bb-8f70-4d5d-85fa-94d1af0d3a41",
  "details": {
    "email": ["email must be an email address"]
  }
}
\`\`\`

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| \`400\` | Bad Request — Validation failed |
| \`401\` | Unauthorized — Missing or invalid token |
| \`403\` | Forbidden — Insufficient permissions |
| \`404\` | Not Found — Resource does not exist |
| \`429\` | Too Many Requests — Rate limit exceeded |
| \`500\` | Internal Server Error |

## Rate Limiting

Rate limit headers are returned on every response:

\`\`\`
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1700000000
\`\`\`
`;
}
