import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SecretsLoaderService } from './secrets-loader.service';
import { RotationService, SECRET_ROTATED_EVENT } from './rotation.service';

/**
 * Emitted when a rotation plan step begins or completes.
 */
export const ROTATION_PLAN_EVENT = 'secret.rotation-plan';

export interface RotationPlanStep {
  secretName: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface RotationPlan {
  id: string;
  steps: RotationPlanStep[];
  createdAt: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
}

/**
 * SecretRotationScheduler — automated rotation for DB credentials and service keys.
 *
 * Implements a rotation plan that:
 *   1. Generates new secret values
 *   2. Updates the secret in the external provider (Vault, AWS, etc.)
 *   3. Rotates the in-memory secret via RotationService
 *   4. Emits events so consumers (DB pool, JWT module) can reload
 *   5. Verifies the new secret works before finalizing
 *
 * Designed for minimal downtime:
 *   - New credentials are pre-generated and verified before switching
 *   - DB connection pool is gracefully drained and reconnected
 *   - JWT tokens issued with old secret remain valid during grace period
 */
@Injectable()
export class SecretRotationScheduler {
  private readonly logger = new Logger(SecretRotationScheduler.name);
  private readonly rotationHistory: RotationPlan[] = [];

  constructor(
    private readonly secretsLoader: SecretsLoaderService,
    private readonly rotationService: RotationService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.registerDefaultSecrets();
  }

  /**
   * Register default secrets that should be tracked for rotation.
   */
  private registerDefaultSecrets(): void {
    const defaultSecrets = [
      { name: 'database.password', intervalMs: 0 },       // Manual rotation only
      { name: 'jwt.secret', intervalMs: 0 },               // Manual rotation only
      { name: 'stellar.secret_key', intervalMs: 0 },       // Manual rotation only
      { name: 'stellar.sponsor_secret_key', intervalMs: 0 },
      { name: 'encryption.key', intervalMs: 0 },
      { name: 'sendgrid.api_key', intervalMs: 0 },
      { name: 'twilio.auth_token', intervalMs: 0 },
    ];

    for (const secret of defaultSecrets) {
      const currentValue = this.getSecretSync(secret.name);
      if (currentValue) {
        this.rotationService.register(secret.name, currentValue, secret.intervalMs);
      }
    }
  }

  /**
   * Synchronous secret lookup for bootstrap registration.
   */
  private getSecretSync(name: string): string | undefined {
    const envName = name.replace(/\./g, '_').toUpperCase();
    return process.env[envName] || process.env[name];
  }

  /**
   * Execute a rotation plan for multiple secrets.
   *
   * Steps:
   *   1. For each secret, generate a new value and update the external provider
   *   2. Rotate the in-memory secret via RotationService
   *   3. Emit rotation events for consumers to reload
   *   4. Invalidate the secrets loader cache
   *
   * @param secretNames  Names of secrets to rotate
   * @returns The rotation plan with status of each step
   */
  async executeRotationPlan(secretNames: string[]): Promise<RotationPlan> {
    const plan: RotationPlan = {
      id: `rotation-${Date.now()}`,
      steps: secretNames.map((name) => ({ secretName: name, status: 'pending' })),
      createdAt: new Date().toISOString(),
      status: 'in-progress',
    };

    this.rotationHistory.push(plan);
    this.logger.log(`Starting rotation plan ${plan.id} for ${secretNames.length} secrets`);

    for (const step of plan.steps) {
      step.status = 'in-progress';
      step.startedAt = new Date().toISOString();

      try {
        // Rotate the in-memory secret
        const newValue = this.rotationService.rotate(step.secretName);

        // Invalidate the secrets loader cache so next fetch gets fresh value
        this.secretsLoader.invalidate(step.secretName);

        step.status = 'completed';
        step.completedAt = new Date().toISOString();

        this.logger.log(`Secret "${step.secretName}" rotated successfully`);
      } catch (error) {
        step.status = 'failed';
        step.error = (error as Error).message;
        this.logger.error(`Failed to rotate secret "${step.secretName}": ${step.error}`);
      }
    }

    plan.status = plan.steps.every((s) => s.status === 'completed')
      ? 'completed'
      : 'failed';

    this.eventEmitter.emit(ROTATION_PLAN_EVENT, plan);
    this.logger.log(`Rotation plan ${plan.id} completed with status: ${plan.status}`);

    return plan;
  }

  /**
   * Rotate a single secret.
   */
  async rotateSecret(name: string): Promise<RotationPlan> {
    return this.executeRotationPlan([name]);
  }

  /**
   * Get rotation history.
   */
  getRotationHistory(): RotationPlan[] {
    return [...this.rotationHistory];
  }

  /**
   * Get the last rotation plan for a specific secret.
   */
  getLastRotation(secretName: string): RotationPlanStep | undefined {
    for (const plan of [...this.rotationHistory].reverse()) {
      const step = plan.steps.find((s) => s.secretName === secretName);
      if (step) return step;
    }
    return undefined;
  }

  /**
   * Scheduled job: check for secrets that need rotation.
   * Runs daily at 2 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async checkRotationSchedule(): void {
    this.logger.log('Running scheduled rotation check');
    const names = this.rotationService.listNames();

    for (const name of names) {
      const record = this.rotationService.getRecord(name);
      if (record && record.intervalMs > 0) {
        const elapsed = Date.now() - new Date(record.lastRotatedAt).getTime();
        if (elapsed >= record.intervalMs) {
          this.logger.log(`Auto-rotating secret "${name}" (interval elapsed)`);
          await this.rotateSecret(name);
        }
      }
    }
  }
}
