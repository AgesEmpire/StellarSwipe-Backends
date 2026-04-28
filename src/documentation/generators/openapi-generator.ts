import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

export interface OpenApiOutput {
  document: OpenAPIObject;
  json: string;
  yaml: string;
}

export function generateOpenApiDocument(app: INestApplication): OpenApiOutput {
  const config = new DocumentBuilder()
    .setTitle('StellarSwipe API')
    .setDescription(
      'Copy trading DApp on Stellar blockchain. Follow top traders, automate trades, and manage your portfolio.',
    )
    .setVersion('2.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT',
    )
    .addTag('Signals', 'Trading signals from providers')
    .addTag('Trades', 'Trade execution and management')
    .addTag('Portfolio', 'Portfolio management and rebalancing')
    .addTag('Users', 'User account management')
    .addTag('Auth', 'Authentication and authorization')
    .addTag('Admin Management', 'Admin operations')
    .addServer('https://api.stellarswipe.com', 'Production')
    .addServer('https://api-staging.stellarswipe.com', 'Staging')
    .addServer('http://localhost:3000', 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const json = JSON.stringify(document, null, 2);

  // Minimal YAML serialisation (no external dep needed for basic output)
  const yaml = jsonToYaml(document);

  return { document, json, yaml };
}

function jsonToYaml(obj: any, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return `${pad}null`;
  if (typeof obj === 'boolean' || typeof obj === 'number') return `${obj}`;
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    return obj.map((v) => `${pad}- ${jsonToYaml(v, indent + 1).trimStart()}`).join('\n');
  }
  const entries = Object.entries(obj);
  if (!entries.length) return '{}';
  return entries
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        return `${pad}${k}:\n${jsonToYaml(v, indent + 1)}`;
      }
      if (Array.isArray(v)) {
        return `${pad}${k}:\n${jsonToYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${jsonToYaml(v, indent)}`;
    })
    .join('\n');
}
