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
