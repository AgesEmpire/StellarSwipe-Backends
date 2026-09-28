import { Signals } from './resources/signals';
import { Trades } from './resources/trades';
import { Portfolio } from './resources/portfolio';
import { Soroban } from './resources/soroban';
import {
  APIError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  NetworkError,
  resolveErrorClass,
} from './errors';
import { withRetry, RetryOptions } from './utils/retry';
import { RequestOptions } from './types';

export interface StellarSwipeClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  retryOptions?: RetryOptions;
}

export class StellarSwipeClient {
  public signals: Signals;
  public trades: Trades;
  public portfolio: Portfolio;
  public soroban: Soroban;

  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private retryOptions: RetryOptions;

  constructor(config: StellarSwipeClientConfig | string) {
    if (typeof config === 'string') {
      this.apiKey = config;
      this.baseUrl = 'https://api.stellarswipe.com';
      this.timeout = 30000;
      this.retryOptions = {};
    } else {
      this.apiKey = config.apiKey;
      this.baseUrl = config.baseUrl || 'https://api.stellarswipe.com';
      this.timeout = config.timeout || 30000;
      this.retryOptions = config.retryOptions || {};
    }

    this.signals = new Signals(this);
    this.trades = new Trades(this);
    this.portfolio = new Portfolio(this);
    this.soroban = new Soroban(this);
  }

  async request<T = any>(
    method: string,
    path: string,
    data?: any,
    options?: RequestOptions
  ): Promise<T> {
    return withRetry(
      async () => {
        const url = `${this.baseUrl}${path}`;
        const timeout = options?.timeout || this.timeout;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, {
            method,
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              ...options?.headers,
            },
            body: data ? JSON.stringify(data) : undefined,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            await this.handleErrorResponse(response);
          }

          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            return await response.json();
          }

          return (await response.text()) as any;
        } catch (error) {
          clearTimeout(timeoutId);

          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              throw new NetworkError('Request timeout');
            }
            if (
              error.message.includes('fetch') ||
              error.message.includes('network')
            ) {
              throw new NetworkError(error.message);
            }
          }
          throw error;
        }
      },
      { ...this.retryOptions, maxRetries: options?.retries ?? this.retryOptions.maxRetries }
    );
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const status = response.status;
    let errorData: any;

    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }

    const message = errorData.message || errorData.error || 'API request failed';
    const backendCode: string | undefined = errorData.errorCode ?? errorData.code;

    // If the backend included a canonical error code, resolve the exact SDK class.
    if (backendCode) {
      const ErrorClass = resolveErrorClass(backendCode);
      // RateLimitError needs the retryAfter header
      if (ErrorClass === RateLimitError) {
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(message, retryAfter ? parseInt(retryAfter, 10) : undefined);
      }
      // NotFoundError has a different constructor signature
      if (ErrorClass === NotFoundError) {
        throw new NotFoundError(errorData.resource || message, errorData.id);
      }
      throw new ErrorClass(message, status, errorData);
    }

    // Fallback: status-based mapping (legacy / no errorCode in response)
    switch (status) {
      case 401:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(errorData.resource || 'Resource', errorData.id);
      case 400:
        throw new ValidationError(message, errorData.errors);
      case 429: {
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(message, retryAfter ? parseInt(retryAfter, 10) : undefined);
      }
      default:
        throw new APIError(message, status, errorData);
    }
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }
}
