import { OpenAPIObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export interface EndpointExample {
  path: string;
  method: string;
  requestExample?: any;
  responseExample?: any;
}

export function extractExamples(document: OpenAPIObject): EndpointExample[] {
  const examples: EndpointExample[] = [];
  const schemas = document.components?.schemas ?? {};
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of methods) {
      const op = (pathItem as any)[method];
      if (!op) continue;

      const entry: EndpointExample = { path, method: method.toUpperCase() };

      // Request body example
      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      if (bodySchema) {
        entry.requestExample = resolveSchemaExample(bodySchema, schemas);
      }

      // Response example from first 2xx response
      const successStatus = Object.keys(op.responses ?? {}).find((s) => s.startsWith('2'));
      if (successStatus) {
        const resSchema = op.responses[successStatus]?.content?.['application/json']?.schema;
        if (resSchema) {
          entry.responseExample = resolveSchemaExample(resSchema, schemas);
        }
      }

      if (entry.requestExample || entry.responseExample) {
        examples.push(entry);
      }
    }
  }

  return examples;
}

function resolveSchemaExample(schema: any, schemas: Record<string, any>, depth = 0): any {
  if (depth > 4) return {};
  if (!schema) return null;

  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return resolveSchemaExample(schemas[name], schemas, depth + 1);
  }

  if (schema.example !== undefined) return schema.example;

  if (schema.type === 'array') {
    return [resolveSchemaExample(schema.items, schemas, depth + 1)];
  }

  if (schema.type === 'object' || schema.properties) {
    const result: Record<string, any> = {};
    for (const [key, prop] of Object.entries<any>(schema.properties ?? {})) {
      result[key] = prop.example ?? resolveSchemaExample(prop, schemas, depth + 1);
    }
    return result;
  }

  return primitiveExample(schema);
}

function primitiveExample(schema: any): any {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'string': return schema.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : schema.format === 'date-time' ? new Date().toISOString() : 'string';
    case 'integer':
    case 'number': return 0;
    case 'boolean': return true;
    default: return null;
  }
}
