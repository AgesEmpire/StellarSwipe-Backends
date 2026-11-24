import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignalCategory } from '../../signals/entities/signal.entity';
import { UserSignalCategoryPreference } from './user-signal-category-preference.entity';

export interface CategoryMutePreferences {
  userId: string;
  mutedCategories: SignalCategory[];
  /** 0 means defaults (no stored preference). Pass back as `expectedVersion`. */
  version: number;
}

const MAX_CAS_ATTEMPTS = 5;
const VALID_CATEGORIES = new Set<string>(Object.values(SignalCategory));
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Category-level feed mutes (#1516). Only touches the preference row: signals
 * and subscriptions are never modified by muting.
 */
@Injectable()
export class SignalCategoryMuteService {
  constructor(
    @InjectRepository(UserSignalCategoryPreference)
    private readonly repo: Repository<UserSignalCategoryPreference>,
  ) {}

  async get(userId: string): Promise<CategoryMutePreferences> {
    const row = await this.repo.findOne({ where: { userId } });
    return row
      ? { userId, mutedCategories: normalize(row.mutedCategories), version: row.version }
      : { userId, mutedCategories: [], version: 0 };
  }

  async getMutedCategories(userId: string): Promise<SignalCategory[]> {
    return (await this.get(userId)).mutedCategories;
  }

  /**
   * Replace the muted set. With `expectedVersion` the write is rejected with
   * 409 if another update landed first; without it, last writer wins but the
   * write is still atomic.
   */
  async replace(
    userId: string,
    categories: string[],
    expectedVersion?: number,
  ): Promise<CategoryMutePreferences> {
    const next = this.validate(categories);
    return this.compareAndSet(userId, expectedVersion, () => next);
  }

  async mute(userId: string, category: string): Promise<CategoryMutePreferences> {
    const [c] = this.validate([category]);
    return this.compareAndSet(userId, undefined, (cur) => normalize([...cur, c]));
  }

  async unmute(userId: string, category: string): Promise<CategoryMutePreferences> {
    const [c] = this.validate([category]);
    return this.compareAndSet(userId, undefined, (cur) => cur.filter((x) => x !== c));
  }

  /** Restore defaults (nothing muted). */
  async reset(userId: string, expectedVersion?: number): Promise<CategoryMutePreferences> {
    return this.compareAndSet(userId, expectedVersion, () => []);
  }

  private async compareAndSet(
    userId: string,
    expectedVersion: number | undefined,
    compute: (current: SignalCategory[]) => SignalCategory[],
  ): Promise<CategoryMutePreferences> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.get(userId);
      if (expectedVersion !== undefined && expectedVersion !== current.version) {
        throw this.conflict(current.version);
      }
      const mutedCategories = compute(current.mutedCategories);

      if (current.version === 0) {
        try {
          await this.repo.insert({ userId, mutedCategories, version: 1 });
          return { userId, mutedCategories, version: 1 };
        } catch (err) {
          if ((err as { code?: string })?.code !== PG_UNIQUE_VIOLATION) throw err;
          // A concurrent first write created the row.
          if (expectedVersion !== undefined) throw this.conflict(undefined);
          continue;
        }
      }

      const result = await this.repo.update(
        { userId, version: current.version },
        { mutedCategories, version: current.version + 1 },
      );
      if (result.affected === 1) {
        return { userId, mutedCategories, version: current.version + 1 };
      }
      if (expectedVersion !== undefined) throw this.conflict(undefined);
      // Lost the race without a caller-supplied version: re-read and retry.
    }
    throw this.conflict(undefined);
  }

  private validate(categories: string[]): SignalCategory[] {
    if (!Array.isArray(categories)) {
      throw new BadRequestException('mutedCategories must be an array');
    }
    const invalid = categories.filter((c) => !VALID_CATEGORIES.has(c));
    if (invalid.length) {
      throw new BadRequestException(
        `Unknown signal categories: ${invalid.join(', ')}. Allowed: ${[...VALID_CATEGORIES].join(', ')}`,
      );
    }
    return normalize(categories as SignalCategory[]);
  }

  private conflict(currentVersion: number | undefined): ConflictException {
    return new ConflictException({
      code: 'CATEGORY_PREFERENCES_VERSION_CONFLICT',
      message: 'Muted category preferences were changed concurrently; re-read and retry.',
      currentVersion,
    });
  }
}

function normalize(categories: SignalCategory[] | null | undefined): SignalCategory[] {
  return [...new Set(categories ?? [])].sort();
}
