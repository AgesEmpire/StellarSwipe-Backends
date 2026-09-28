import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DocGeneratorService } from './doc-generator.service';

/**
 * DocsController
 *
 * Exposes versioned, authenticated REST endpoints for API documentation and
 * schema introspection.  Intended for developers and internal tooling.
 *
 * Routes (all under the global prefix):
 *   GET /docs/api-info         – Summary of current API: version, route count, tags
 *   GET /docs/openapi.json     – Full OpenAPI 3 spec (JSON)
 *   GET /docs/openapi.yaml     – Full OpenAPI 3 spec (YAML)
 *   GET /docs/endpoints        – List of routes with method, path, and summary
 *   GET /docs/schemas          – All component schemas defined in the spec
 */
@ApiTags('documentation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('docs')
export class DocsController {
  constructor(private readonly docGenerator: DocGeneratorService) {}

  // ---------------------------------------------------------------------------
  // GET /docs/api-info
  // ---------------------------------------------------------------------------

  @Get('api-info')
  @Version('1')
  @ApiOperation({
    summary: 'Get API metadata overview',
    description:
      'Returns the current API version, total endpoint count, available tags, ' +
      'and the timestamp the spec was last generated.',
  })
  @ApiResponse({
    status: 200,
    description: 'API metadata overview',
    schema: {
      example: {
        title: 'StellarSwipe API',
        version: '2.0.0',
        endpointCount: 148,
        tagCount: 22,
        tags: ['auth', 'trades', 'signals'],
        generatedAt: '2026-05-26T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Documentation not yet generated' })
  getApiInfo() {
    const doc = this.docGenerator.getCachedDocument();
    if (!doc) {
      throw new NotFoundException(
        'API documentation has not been generated yet. ' +
          'The spec is built during application startup; please retry shortly.',
      );
    }

    const paths = doc.paths ?? {};
    const endpointCount = Object.values(paths).reduce((sum, pathItem) => {
      const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
      return sum + methods.filter((m) => pathItem && (pathItem as Record<string, unknown>)[m]).length;
    }, 0);

    const tags: string[] = (doc.tags ?? []).map((t) => t.name);

    return {
      title: doc.info?.title ?? 'StellarSwipe API',
      version: doc.info?.version ?? 'unknown',
      endpointCount,
      tagCount: tags.length,
      tags,
      generatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /docs/openapi.json
  // ---------------------------------------------------------------------------

  @Get('openapi.json')
  @Version('1')
  @Header('Content-Type', 'application/json')
  @ApiOperation({ summary: 'Download full OpenAPI 3 spec (JSON)' })
  @ApiResponse({ status: 200, description: 'OpenAPI specification in JSON format' })
  @ApiResponse({ status: 404, description: 'Documentation not yet generated' })
  getOpenApiJson(): object {
    const doc = this.docGenerator.getCachedDocument();
    if (!doc) {
      throw new NotFoundException('OpenAPI document is not available yet.');
    }
    return doc;
  }

  // ---------------------------------------------------------------------------
  // GET /docs/endpoints
  // ---------------------------------------------------------------------------

  @Get('endpoints')
  @Version('1')
  @ApiOperation({ summary: 'List all registered API endpoints' })
  @ApiQuery({
    name: 'tag',
    required: false,
    description: 'Filter endpoints by tag name (case-insensitive)',
  })
  @ApiResponse({
    status: 200,
    description: 'Array of endpoint descriptors',
    schema: {
      example: [
        {
          method: 'POST',
          path: '/api/v2/trades/execute',
          summary: 'Execute a trade',
          tags: ['trades'],
          operationId: 'TradesController_executeTrade',
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: 'Documentation not yet generated' })
  getEndpoints(@Query('tag') tag?: string) {
    const doc = this.docGenerator.getCachedDocument();
    if (!doc) {
      throw new NotFoundException('OpenAPI document is not available yet.');
    }

    const endpoints: Array<{
      method: string;
      path: string;
      summary?: string;
      tags?: string[];
      operationId?: string;
    }> = [];

    const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

    for (const [routePath, pathItem] of Object.entries(doc.paths ?? {})) {
      for (const method of httpMethods) {
        const operation = pathItem?.[method] as Record<string, unknown> | undefined;
        if (!operation) continue;

        const opTags = (operation['tags'] as string[] | undefined) ?? [];
        if (tag && !opTags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
          continue;
        }

        endpoints.push({
          method: method.toUpperCase(),
          path: routePath,
          summary: operation['summary'] as string | undefined,
          tags: opTags,
          operationId: operation['operationId'] as string | undefined,
        });
      }
    }

    return endpoints;
  }

  // ---------------------------------------------------------------------------
  // GET /docs/schemas
  // ---------------------------------------------------------------------------

  @Get('schemas')
  @Version('1')
  @ApiOperation({ summary: 'List all component schemas defined in the API spec' })
  @ApiQuery({
    name: 'name',
    required: false,
    description: 'Return a single schema by name (exact match)',
  })
  @ApiResponse({ status: 200, description: 'Schema map or single schema object' })
  @ApiResponse({ status: 404, description: 'Documentation not yet generated or schema not found' })
  getSchemas(@Query('name') name?: string) {
    const doc = this.docGenerator.getCachedDocument();
    if (!doc) {
      throw new NotFoundException('OpenAPI document is not available yet.');
    }

    const schemas = (doc.components?.schemas ?? {}) as Record<string, unknown>;

    if (name) {
      const schema = schemas[name];
      if (!schema) {
        throw new NotFoundException(`Schema "${name}" not found in the API specification.`);
      }
      return { [name]: schema };
    }

    return {
      count: Object.keys(schemas).length,
      schemas,
    };
  }
}
