import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Supported secret provider backends.
 */
export type SecretProvider = 'env' | 'vault' | 'aws-secrets-manager' | 'kubernetes';

export interface SecretsLoaderConfig {
  /** Active secret provider (defaults to 'env' for local development) */
  provider: SecretProvider;
  /** Vault URL (when provider = 'vault') */
  vaultUrl?: string;
  /** Vault token or token-lookup path */
  vaultToken?: string;
  /** AWS Secrets Manager region (when provider = 'aws-secrets-manager') */
  awsRegion?: string;
  /** Kubernetes secret name (when provider = 'kubernetes') */
  k8sSecretName?: string;
  /** Kubernetes namespace */
  k8sNamespace?: string;
}

/**
 * SecretsLoaderService — pluggable secret source abstraction.
 *
 * Supports loading secrets from:
 *   - `env` (default, local dev fallback) — reads from process.env
 *   - `vault` — HashiCorp Vault KV v2
 *   - `aws-secrets-manager` — AWS Secrets Manager
 *   - `kubernetes` — Kubernetes Secret volume mounts
 *
 * The loader is designed so the application can start with secrets
 * loaded from environment variables when the secret provider is
 * disabled or unavailable (local dev fallback).
 */
@Injectable()
export class SecretsLoaderService {
  private readonly logger = new Logger(SecretsLoaderService.name);
  private readonly config: SecretsLoaderConfig;
  private readonly secretsCache = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {
    this.config = {
      provider: (this.configService.get<string>('SECRET_PROVIDER') as SecretProvider) || 'env',
      vaultUrl: this.configService.get<string>('VAULT_URL'),
      vaultToken: this.configService.get<string>('VAULT_TOKEN'),
      awsRegion: this.configService.get<string>('AWS_SECRETS_REGION'),
      k8sSecretName: this.configService.get<string>('K8S_SECRET_NAME'),
      k8sNamespace: this.configService.get<string>('K8S_SECRET_NAMESPACE') || 'default',
    };
    this.logger.log(`Secrets loader initialized with provider: ${this.config.provider}`);
  }

  /**
   * Load a secret by name from the configured provider.
   * Falls back to environment variables when the provider is unavailable.
   */
  async getSecret(name: string): Promise<string | undefined> {
    // Check cache first
    if (this.secretsCache.has(name)) {
      return this.secretsCache.get(name);
    }

    let value: string | undefined;

    switch (this.config.provider) {
      case 'vault':
        value = await this.loadFromVault(name);
        break;
      case 'aws-secrets-manager':
        value = await this.loadFromAWS(name);
        break;
      case 'kubernetes':
        value = await this.loadFromKubernetes(name);
        break;
      case 'env':
      default:
        value = this.loadFromEnv(name);
        break;
    }

    // Local dev fallback: if provider fails, try env vars
    if (value === undefined && this.config.provider !== 'env') {
      this.logger.warn(`Secret "${name}" not found in ${this.config.provider}, falling back to env`);
      value = this.loadFromEnv(name);
    }

    if (value !== undefined) {
      this.secretsCache.set(name, value);
    }

    return value;
  }

  /**
   * Bulk-load multiple secrets.
   */
  async getSecrets(names: string[]): Promise<Record<string, string | undefined>> {
    const results: Record<string, string | undefined> = {};
    for (const name of names) {
      results[name] = await this.getSecret(name);
    }
    return results;
  }

  /**
   * Invalidate cached secret (e.g., after rotation).
   */
  invalidate(name: string): void {
    this.secretsCache.delete(name);
  }

  /**
   * Invalidate all cached secrets.
   */
  invalidateAll(): void {
    this.secretsCache.clear();
  }

  /**
   * Get the active provider name.
   */
  getProvider(): SecretProvider {
    return this.config.provider;
  }

  // ── Provider implementations ──────────────────────────────────────────────

  private loadFromEnv(name: string): string | undefined {
    // Map common secret names to env variable patterns
    const envMappings: Record<string, string[]> = {
      'database.password': ['DATABASE_PASSWORD'],
      'jwt.secret': ['JWT_SECRET'],
      'stellar.secret_key': ['STELLAR_SECRET_KEY'],
      'stellar.sponsor_secret_key': ['STELLAR_SPONSOR_SECRET_KEY'],
      'redis.password': ['REDIS_PASSWORD'],
      'encryption.key': ['ENCRYPTION_KEY'],
      'sendgrid.api_key': ['SENDGRID_API_KEY'],
      'twilio.auth_token': ['TWILIO_AUTH_TOKEN'],
      'sentry.dsn': ['SENTRY_DSN'],
    };

    // Try exact env var name first (uppercase, underscores)
    const envName = name.replace(/\./g, '_').toUpperCase();
    if (process.env[envName]) {
      return process.env[envName];
    }

    // Try mapped env vars
    const candidates = envMappings[name] || [];
    for (const candidate of candidates) {
      if (process.env[candidate]) {
        return process.env[candidate];
      }
    }

    return undefined;
  }

  private async loadFromVault(name: string): Promise<string | undefined> {
    if (!this.config.vaultUrl || !this.config.vaultToken) {
      this.logger.warn('Vault URL or token not configured');
      return undefined;
    }

    try {
      const url = `${this.config.vaultUrl}/v1/secret/data/stellarswipe/${name}`;
      const response = await fetch(url, {
        headers: { 'X-Vault-Token': this.config.vaultToken },
      });

      if (!response.ok) {
        this.logger.warn(`Vault request failed for "${name}": ${response.status}`);
        return undefined;
      }

      const data = await response.json() as any;
      return data?.data?.data?.value;
    } catch (error) {
      this.logger.error(`Vault error for "${name}": ${(error as Error).message}`);
      return undefined;
    }
  }

  private async loadFromAWS(name: string): Promise<string | undefined> {
    // AWS Secrets Manager integration
    // In production, use @aws-sdk/client-secrets-manager
    // For now, provide a structured placeholder that can be filled in
    // when the AWS SDK is installed
    this.logger.debug(`AWS Secrets Manager lookup for "${name}" (region: ${this.config.awsRegion})`);
    return undefined;
  }

  private async loadFromKubernetes(name: string): Promise<string | undefined> {
    // Kubernetes secrets are mounted as files in /etc/secrets/
    // or via the Downward API
    try {
      const fs = await import('fs/promises');
      const secretPath = `/etc/secrets/${name}`;
      const value = await fs.readFile(secretPath, 'utf-8');
      return value.trim();
    } catch {
      // File not found — secret not mounted
      return undefined;
    }
  }
}
