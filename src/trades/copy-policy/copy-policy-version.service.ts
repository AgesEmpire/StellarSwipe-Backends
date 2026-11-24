import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import {
  CopyPolicyVersion,
  CopySettingsInput,
  CopyTradeExecution,
  ResolvedCopySettings,
} from './copy-policy-version.entity';

export const DEFAULT_COPY_SETTINGS: Readonly<ResolvedCopySettings> = Object.freeze({
  allocationRatio: 1,
  maxTradeAmount: 1000,
  slippageTolerancePct: 0.5,
  stopLossPct: null,
  takeProfitPct: null,
  copySells: true,
});

const SETTING_KEYS = Object.keys(DEFAULT_COPY_SETTINGS) as Array<keyof ResolvedCopySettings>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/**
 * Versioned copy-policy store (#1520).
 *
 * - `updatePolicy` appends a new version (no-op if the resolved settings are unchanged).
 * - `recordExecution` snapshots the current version onto an execution record.
 * - Historical execution reads return the snapshot, independent of later edits.
 */
@Injectable()
export class CopyPolicyVersionService {
  constructor(
    @InjectRepository(CopyPolicyVersion)
    private readonly versions: Repository<CopyPolicyVersion>,
    @InjectRepository(CopyTradeExecution)
    private readonly executions: Repository<CopyTradeExecution>,
  ) {}

  /** Merges input over a base and validates the result. */
  resolveSettings(
    input: CopySettingsInput,
    base: ResolvedCopySettings = DEFAULT_COPY_SETTINGS,
  ): ResolvedCopySettings {
    const resolved: ResolvedCopySettings = { ...base };
    for (const key of SETTING_KEYS) {
      if (input[key] !== undefined) (resolved as any)[key] = input[key];
    }
    const errors: string[] = [];
    if (!(resolved.allocationRatio > 0 && resolved.allocationRatio <= 1)) {
      errors.push('allocationRatio must be in (0, 1]');
    }
    if (!(resolved.maxTradeAmount > 0)) errors.push('maxTradeAmount must be positive');
    if (!(resolved.slippageTolerancePct >= 0 && resolved.slippageTolerancePct <= 100)) {
      errors.push('slippageTolerancePct must be in [0, 100]');
    }
    for (const k of ['stopLossPct', 'takeProfitPct'] as const) {
      const v = resolved[k];
      if (v !== null && !(v > 0 && v <= 100)) errors.push(`${k} must be null or in (0, 100]`);
    }
    if (typeof resolved.copySells !== 'boolean') errors.push('copySells must be boolean');
    if (errors.length) {
      throw new BadRequestException({ message: 'Invalid copy settings', errors });
    }
    return resolved;
  }

  hashSettings(settings: ResolvedCopySettings): string {
    const canonical = SETTING_KEYS.map((k) => [k, settings[k]]);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  async getCurrentVersion(
    followerId: string,
    providerId: string,
  ): Promise<CopyPolicyVersion | null> {
    return this.versions.findOne({
      where: { followerId, providerId },
      order: { version: 'DESC' },
    });
  }

  async listVersions(followerId: string, providerId: string): Promise<CopyPolicyVersion[]> {
    return this.versions.find({
      where: { followerId, providerId },
      order: { version: 'ASC' },
    });
  }

  /**
   * Creates a new policy version. Partial input is merged over the current
   * version, so unspecified settings carry forward. Earlier versions and any
   * executions referencing them are never modified.
   */
  async updatePolicy(
    followerId: string,
    providerId: string,
    input: CopySettingsInput,
  ): Promise<CopyPolicyVersion> {
    const current = await this.getCurrentVersion(followerId, providerId);
    const settings = this.resolveSettings(input, current?.settings ?? DEFAULT_COPY_SETTINGS);
    const settingsHash = this.hashSettings(settings);
    if (current && current.settingsHash === settingsHash) return current;

    const next = this.versions.create({
      followerId,
      providerId,
      version: (current?.version ?? 0) + 1,
      settings,
      settingsHash,
    });
    try {
      // insert (not save) so an existing row can never be overwritten
      await this.versions.insert(next);
    } catch (err) {
      throw new ConflictException(
        'Copy policy was updated concurrently; retry with the latest version',
      );
    }
    return next;
  }

  /**
   * Snapshots the follower's current policy onto a trade execution record.
   * Creates a default v1 policy if the follower never customised settings, so
   * every execution always references a concrete version.
   */
  async recordExecution(
    tradeId: string,
    followerId: string,
    providerId: string,
  ): Promise<CopyTradeExecution> {
    const existing = await this.executions.findOne({ where: { tradeId } });
    if (existing) return deepFreeze(existing); // idempotent; snapshot is immutable

    const policy =
      (await this.getCurrentVersion(followerId, providerId)) ??
      (await this.updatePolicy(followerId, providerId, {}));

    const record = this.executions.create({
      tradeId,
      followerId,
      providerId,
      policyVersionId: policy.id,
      policyVersion: policy.version,
      resolvedSettings: { ...policy.settings },
    });
    await this.executions.insert(record);
    return deepFreeze(record);
  }

  /** Reads an execution with the settings that applied at execution time. */
  async getExecution(tradeId: string): Promise<CopyTradeExecution> {
    const record = await this.executions.findOne({ where: { tradeId } });
    if (!record) throw new NotFoundException(`No copy execution for trade ${tradeId}`);
    return deepFreeze(record);
  }
}
