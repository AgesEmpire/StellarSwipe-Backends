import { HttpModule, HttpService } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { Agent } from 'http';

/**
 * Dependency timeout budgets for outbound HTTP clients.
 *
 * Standardizes connection and response timeouts so every external service
 * client terminates within configured bounds. Values are sourced from the
 * validated configuration (see src/config/validation.schema.ts) and fall back
 * to safe defaults when unset.
 */
export const HTTP_CONNECT_TIMEOUT_MS = 3000;
export const HTTP_RESPONSE_TIMEOUT_MS = 10000;

/**
 * Builds the shared axios/http options used by every outbound client so that
 * timeout errors and metrics stay consistent across services.
 */
export function buildHttpClientOptions(config: ConfigService) {
  const connectTimeout = Number(
    config.get<number>('HTTP_CONNECT_TIMEOUT_MS') ?? HTTP_CONNECT_TIMEOUT_MS,
  );
  const responseTimeout = Number(
    config.get<number>('HTTP_RESPONSE_TIMEOUT_MS') ?? HTTP_RESPONSE_TIMEOUT_MS,
  );

  return {
    timeout: responseTimeout,
    maxRedirects: 3,
    httpAgent: new Agent({ keepAlive: true, timeout: connectTimeout }),
    httpsAgent: new (require('https').Agent)({
      keepAlive: true,
      timeout: connectTimeout,
    }),
  };
}

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildHttpClientOptions(config),
    }),
  ],
  providers: [
    {
      provide: 'HTTP_CLIENT_OPTIONS',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildHttpClientOptions(config),
    },
  ],
  exports: [HttpModule, 'HTTP_CLIENT_OPTIONS'],
})
export class HttpClientModule {}
