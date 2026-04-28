import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { OpenAPIObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

export interface ExtractedEndpoint {
  path: string;
  method: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: any[];
  requestBody?: any;
  responses: Record<string, any>;
  security?: any[];
}

export function extractEndpoints(document: OpenAPIObject): ExtractedEndpoint[] {
  const endpoints: ExtractedEndpoint[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of methods) {
      const op = (pathItem as any)[method];
      if (!op) continue;

      endpoints.push({
        path,
        method: method.toUpperCase(),
        summary: op.summary,
        description: op.description,
        tags: op.tags ?? [],
        parameters: op.parameters ?? [],
        requestBody: op.requestBody,
        responses: op.responses ?? {},
        security: op.security,
      });
    }
  }

  return endpoints;
}

export function extractSchemas(document: OpenAPIObject): Record<string, any> {
  return document.components?.schemas ?? {};
}

export function extractTags(document: OpenAPIObject): string[] {
  return (document.tags ?? []).map((t) => t.name);
}
