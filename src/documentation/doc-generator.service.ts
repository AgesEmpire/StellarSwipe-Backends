import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { generateMarkdown } from './generators/markdown-generator';
import { generatePostmanCollection } from './generators/postman-generator';
import { renderApiReferenceTemplate } from './templates/api-reference.template';
import { renderGettingStartedTemplate } from './templates/getting-started.template';
import { renderUseCaseTemplate } from './templates/use-case.template';
import { extractEndpoints, extractSchemas, extractTags } from './extractors/decorator-extractor';
import { extractExamples } from './extractors/example-extractor';
import { DOC_REGEN_QUEUE } from './jobs/regenerate-docs.job';

export interface GeneratedDocs {
  openApiJson: string;
  openApiYaml: string;
  markdown: string;
  postmanCollection: object;
  apiReference: string;
  gettingStarted: string;
  useCases: string;
  generatedAt: Date;
  endpointCount: number;
  tagCount: number;
}

@Injectable()
export class DocGeneratorService implements OnModuleInit {
  private readonly logger = new Logger(DocGeneratorService.name);
  private readonly outputDir: string;
  private cachedDocument: OpenAPIObject | null = null;

  constructor(
    @InjectQueue(DOC_REGEN_QUEUE) private readonly regenQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.outputDir = path.resolve(process.cwd(), 'docs', 'generated');
  }

  onModuleInit() {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  setDocument(document: OpenAPIObject): void {
    this.cachedDocument = document;
  }

  async generateAll(): Promise<GeneratedDocs> {
    if (!this.cachedDocument) {
      throw new Error('OpenAPI document not set. Call setDocument() first.');
    }

    const document = this.cachedDocument;
    const baseUrl = this.configService.get<string>('app.baseUrl') ?? 'http://localhost:3000';

    const openApiJson = JSON.stringify(document, null, 2);
    const markdown = generateMarkdown(document);
    const postmanCollection = generatePostmanCollection(document);
    const apiReference = renderApiReferenceTemplate(document);
    const gettingStarted = renderGettingStartedTemplate(baseUrl);
    const useCases = renderUseCaseTemplate();
    const endpoints = extractEndpoints(document);
    const tags = extractTags(document);
    const examples = extractExamples(document);

    this.logger.log(`Extracted ${endpoints.length} endpoints, ${tags.length} tags, ${examples.length} examples`);

    // Persist to disk
    this.write('openapi.json', openApiJson);
    this.write('openapi.md', markdown);
    this.write('postman-collection.json', JSON.stringify(postmanCollection, null, 2));
    this.write('api-reference.md', apiReference);
    this.write('getting-started.md', gettingStarted);
    this.write('use-cases.md', useCases);

    const result: GeneratedDocs = {
      openApiJson,
      openApiYaml: '',          // populated by openapi-generator when called from main.ts
      markdown,
      postmanCollection,
      apiReference,
      gettingStarted,
      useCases,
      generatedAt: new Date(),
      endpointCount: endpoints.length,
      tagCount: tags.length,
    };

    this.logger.log(`Documentation generated → ${this.outputDir}`);
    return result;
  }

  async scheduleRegeneration(reason = 'manual'): Promise<void> {
    await this.regenQueue.add('regenerate', { reason }, { attempts: 3, backoff: 5000 });
    this.logger.log(`Queued doc regeneration: ${reason}`);
  }

  getOutputDir(): string {
    return this.outputDir;
  }

  private write(filename: string, content: string): void {
    fs.writeFileSync(path.join(this.outputDir, filename), content, 'utf-8');
  }
}
