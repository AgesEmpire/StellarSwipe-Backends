import { OpenAPIObject, PathItemObject, OperationObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export interface PostmanCollection {
  info: { name: string; description: string; schema: string };
  item: PostmanFolder[];
  variable: { key: string; value: string }[];
}

interface PostmanFolder {
  name: string;
  item: PostmanRequest[];
}

interface PostmanRequest {
  name: string;
  request: {
    method: string;
    header: { key: string; value: string }[];
    url: { raw: string; host: string[]; path: string[]; query?: { key: string; value: string }[] };
    body?: { mode: string; raw: string; options: { raw: { language: string } } };
    description?: string;
  };
}

export function generatePostmanCollection(document: OpenAPIObject): PostmanCollection {
  const baseUrl = '{{baseUrl}}';
  const tagMap: Record<string, PostmanRequest[]> = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    const item = pathItem as PathItemObject;
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

    for (const method of methods) {
      const op = (item as any)[method] as OperationObject | undefined;
      if (!op) continue;

      const tags = op.tags ?? ['General'];
      const queryParams = ((op.parameters ?? []) as any[])
        .filter((p) => p.in === 'query')
        .map((p) => ({ key: p.name, value: p.example ?? '' }));

      // Replace path params with Postman variables
      const postmanPath = path.replace(/{(\w+)}/g, ':$1');
      const pathSegments = postmanPath.split('/').filter(Boolean);

      const request: PostmanRequest = {
        name: op.summary ?? `${method.toUpperCase()} ${path}`,
        request: {
          method: method.toUpperCase(),
          header: [
            { key: 'Authorization', value: 'Bearer {{token}}' },
            { key: 'Content-Type', value: 'application/json' },
          ],
          url: {
            raw: `${baseUrl}/${pathSegments.join('/')}${queryParams.length ? '?' + queryParams.map((q) => `${q.key}=${q.value}`).join('&') : ''}`,
            host: [baseUrl],
            path: pathSegments,
            ...(queryParams.length ? { query: queryParams } : {}),
          },
          ...(op.description ? { description: op.description } : {}),
        },
      };

      // Add request body for POST/PUT/PATCH
      if (['post', 'put', 'patch'].includes(method) && (op as any).requestBody) {
        const schema = (op as any).requestBody?.content?.['application/json']?.schema;
        const example = buildExampleFromSchema(schema, document.components?.schemas ?? {});
        request.request.body = {
          mode: 'raw',
          raw: JSON.stringify(example, null, 2),
          options: { raw: { language: 'json' } },
        };
      }

      tags.forEach((tag) => {
        if (!tagMap[tag]) tagMap[tag] = [];
        tagMap[tag].push(request);
      });
    }
  }

  return {
    info: {
      name: document.info.title,
      description: document.info.description ?? '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: Object.entries(tagMap).map(([name, item]) => ({ name, item })),
    variable: [
      { key: 'baseUrl', value: document.servers?.[0]?.url ?? 'http://localhost:3000' },
      { key: 'token', value: '' },
    ],
  };
}

function buildExampleFromSchema(schema: any, schemas: Record<string, any>): any {
  if (!schema) return {};
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop();
    return buildExampleFromSchema(schemas[refName], schemas);
  }
  if (schema.type === 'object' || schema.properties) {
    const result: Record<string, any> = {};
    for (const [key, prop] of Object.entries<any>(schema.properties ?? {})) {
      result[key] = prop.example ?? getDefaultForType(prop.type);
    }
    return result;
  }
  if (schema.type === 'array') return [buildExampleFromSchema(schema.items, schemas)];
  return schema.example ?? getDefaultForType(schema.type);
}

function getDefaultForType(type: string): any {
  switch (type) {
    case 'string': return 'string';
    case 'number':
    case 'integer': return 0;
    case 'boolean': return true;
    default: return null;
  }
}
