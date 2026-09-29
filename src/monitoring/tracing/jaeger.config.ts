type OTelModule = Record<string, any>;

let otelSdk: { start: () => void; shutdown: () => Promise<void> | void } | undefined;

function optionalRequire(name: string): OTelModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name);
  } catch {
    return undefined;
  }
}

export function initTracing(): void {
  if (process.env.NODE_ENV === 'test' || process.env.TRACING_ENABLED !== 'true') return;

  const sdkNode = optionalRequire('@opentelemetry/sdk-node');
  const exporterModule = optionalRequire('@opentelemetry/exporter-trace-otlp-http');
  const resourcesModule = optionalRequire('@opentelemetry/resources');
  const semanticModule = optionalRequire('@opentelemetry/semantic-conventions');
  const traceBaseModule = optionalRequire('@opentelemetry/sdk-trace-base');
  const httpModule = optionalRequire('@opentelemetry/instrumentation-http');
  const expressModule = optionalRequire('@opentelemetry/instrumentation-express');
  const pgModule = optionalRequire('@opentelemetry/instrumentation-pg');
  const ioredisModule = optionalRequire('@opentelemetry/instrumentation-ioredis');

  if (!sdkNode || !exporterModule || !resourcesModule || !traceBaseModule) {
    // Dependencies are intentionally optional in this repo; deployments that
    // install OpenTelemetry get real spans, local/test runs stay no-op.
    return;
  }

  const { NodeSDK } = sdkNode;
  const { OTLPTraceExporter } = exporterModule;
  const { Resource } = resourcesModule;
  const { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } = traceBaseModule;
  const serviceNameAttr = semanticModule?.SEMRESATTRS_SERVICE_NAME ?? 'service.name';
  const serviceVersionAttr = semanticModule?.SEMRESATTRS_SERVICE_VERSION ?? 'service.version';
  const sampleRate = Number(process.env.OTEL_TRACES_SAMPLER_ARG ?? process.env.TRACING_SAMPLE_RATE ?? 1);

  const instrumentations = [
    httpModule?.HttpInstrumentation
      ? new httpModule.HttpInstrumentation({
          // Never record headers/bodies; strip query strings that may carry tokens.
          ignoreIncomingRequestHook: (req: any) => /^\/health/.test(req.url ?? ''),
          requestHook: (span: any, req: any) => {
            const url = req?.url ?? req?.path;
            if (typeof url === 'string') span.setAttribute('http.target', url.split('?')[0]);
          },
        })
      : undefined,
    expressModule?.ExpressInstrumentation ? new expressModule.ExpressInstrumentation() : undefined,
    // enhancedDatabaseReporting=false keeps bound parameter values out of spans.
    pgModule?.PgInstrumentation ? new pgModule.PgInstrumentation({ enhancedDatabaseReporting: false }) : undefined,
    ioredisModule?.IORedisInstrumentation ? new ioredisModule.IORedisInstrumentation({ dbStatementSerializer: (cmd: string) => cmd }) : undefined,
  ].filter(Boolean);

  otelSdk = new NodeSDK({
    resource: new Resource({
      [serviceNameAttr]: process.env.TRACING_SERVICE_NAME ?? 'stellarswipe-backend',
      [serviceVersionAttr]: process.env.npm_package_version ?? '0.1.0',
    }),
    // Batch export is async and off the request path; exporter failures are
    // swallowed by safeExporter so they can never fail a request.
    spanProcessor: new BatchSpanProcessor(
      safeExporter(
        new OTLPTraceExporter({
          url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.JAEGER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
        }),
      ),
    ),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(Math.min(1, Math.max(0, sampleRate))),
    }),
    instrumentations,
  });

  try {
    otelSdk.start();
  } catch {
    otelSdk = undefined;
    return;
  }
  process.on('SIGTERM', () => {
    Promise.resolve(otelSdk?.shutdown()).catch(() => undefined);
  });
}

/** Wrap an exporter so export errors resolve as failures instead of throwing. */
export function safeExporter(exporter: any): any {
  return {
    export(spans: unknown[], resultCallback: (result: { code: number; error?: Error }) => void) {
      try {
        exporter.export(spans, (result: { code: number; error?: Error }) => resultCallback(result));
      } catch (error) {
        resultCallback({ code: 1, error: error as Error });
      }
    },
    shutdown: () => Promise.resolve(exporter.shutdown?.()).catch(() => undefined),
    forceFlush: () => Promise.resolve(exporter.forceFlush?.()).catch(() => undefined),
  };
}
