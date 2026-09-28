import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom, timeout as rxTimeout, TimeoutError } from 'rxjs';

/**
 * Standardized timeout budgets for outbound HTTP calls to external services.
 *
 * Every outbound request is bounded by a connection timeout and a total
 * response timeout so that calls terminate within configured bounds and
 * timeout failures surface consistently across all clients.
 */
export interface HttpTimeoutBudget {
  /** Max time (ms) to establish a connection to the remote host. */
  connectionTimeoutMs: number;
  /** Max total time (ms) allowed for the full request/response cycle. */
  responseTimeoutMs: number;
}

/**
 * Error thrown when an outbound dependency call exceeds its configured budget.
 * Kept consistent so callers and metrics can classify timeouts uniformly.
 */
export class DependencyTimeoutError extends Error {
  readonly code = 'DEPENDENCY_TIMEOUT';

  constructor(
    readonly url: string,
    readonly budgetMs: number,
  ) {
    super(
      `Outbound request to ${url} exceeded the ${budgetMs}ms dependency timeout budget`,
    );
    this.name = 'DependencyTimeoutError';
  }
}

@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolve the timeout budget for a given dependency from configuration,
   * falling back to sane defaults when no per-dependency override is set.
   */
  getTimeoutBudget(dependency?: string): HttpTimeoutBudget {
    const defaultConnection = this.configService.get<number>(
      'http.connectionTimeoutMs',
      3000,
    );
    const defaultResponse = this.configService.get<number>(
      'http.responseTimeoutMs',
      10000,
    );

    if (!dependency) {
      return {
        connectionTimeoutMs: defaultConnection,
        responseTimeoutMs: defaultResponse,
      };
    }

    return {
      connectionTimeoutMs: this.configService.get<number>(
        `http.dependencies.${dependency}.connectionTimeoutMs`,
        defaultConnection,
      ),
      responseTimeoutMs: this.configService.get<number>(
        `http.dependencies.${dependency}.responseTimeoutMs`,
        defaultResponse,
      ),
    };
  }

  /**
   * Perform a bounded outbound request. Connection and response timeouts are
   * applied from the resolved budget, and any timeout is normalized into a
   * DependencyTimeoutError so error handling and metrics stay consistent.
   */
  async request<T = unknown>(
    config: AxiosRequestConfig,
    dependency?: string,
  ): Promise<AxiosResponse<T>> {
    const budget = this.getTimeoutBudget(dependency);
    const url = config.url ?? 'unknown';

    const requestConfig: AxiosRequestConfig = {
      ...config,
      timeout: budget.connectionTimeoutMs,
    };

    try {
      return await firstValueFrom(
        this.httpService
          .request<T>(requestConfig)
          .pipe(rxTimeout(budget.responseTimeoutMs)),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        this.logger.warn(
          `Dependency timeout for ${url} after ${budget.responseTimeoutMs}ms`,
        );
        throw new DependencyTimeoutError(url, budget.responseTimeoutMs);
      }

      throw error;
    }
  }
}
