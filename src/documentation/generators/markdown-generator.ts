import { OpenAPIObject, PathItemObject, OperationObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export function generateMarkdown(document: OpenAPIObject): string {
  const lines: string[] = [];

  lines.push(`# ${document.info.title}`);
  lines.push(`\n> ${document.info.description ?? ''}`);
  lines.push(`\n**Version:** ${document.info.version}`);

  if (document.servers?.length) {
    lines.push('\n## Servers\n');
    document.servers.forEach((s) => lines.push(`- **${s.description ?? s.url}**: \`${s.url}\``));
  }

  lines.push('\n## Authentication\n');
  lines.push('All endpoints require a Bearer JWT token:\n');
  lines.push('```\nAuthorization: Bearer <token>\n```');

  // Group paths by tag
  const tagMap: Record<string, { path: string; method: string; op: OperationObject }[]> = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const item = pathItem as PathItemObject;
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const method of methods) {
      const op = (item as any)[method] as OperationObject | undefined;
      if (!op) continue;
      const tags = op.tags ?? ['General'];
      tags.forEach((tag) => {
        if (!tagMap[tag]) tagMap[tag] = [];
        tagMap[tag].push({ path, method: method.toUpperCase(), op });
      });
    }
  }

  for (const [tag, endpoints] of Object.entries(tagMap)) {
    lines.push(`\n## ${tag}\n`);
    for (const { path, method, op } of endpoints) {
      lines.push(`### ${op.summary ?? path}`);
      lines.push(`\`${method} ${path}\``);
      if (op.description) lines.push(`\n${op.description}`);

      if (op.parameters?.length) {
        lines.push('\n**Parameters:**\n');
        lines.push('| Name | In | Required | Type | Description |');
        lines.push('|------|----|----------|------|-------------|');
        op.parameters.forEach((p: any) => {
          lines.push(
            `| \`${p.name}\` | ${p.in} | ${p.required ? 'Yes' : 'No'} | ${p.schema?.type ?? '-'} | ${p.description ?? '-'} |`,
          );
        });
      }

      const responses = op.responses ?? {};
      lines.push('\n**Responses:**\n');
      lines.push('| Status | Description |');
      lines.push('|--------|-------------|');
      for (const [status, res] of Object.entries(responses)) {
        lines.push(`| \`${status}\` | ${(res as any).description ?? '-'} |`);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}
