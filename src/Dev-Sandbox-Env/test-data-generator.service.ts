import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SandboxEnvironment, SandboxTier } from '../entities/sandbox-environment.entity';

export interface SeedScenario {
  name: string;
  userCount: number;
  artistCount: number;
  trackCount: number;
  tipCount: number;
  subscriptionCount: number;
  withStellarTransactions: boolean;
}

export interface GeneratedSeedSummary {
  users: number;
  artists: number;
  tracks: number;
  tips: number;
  subscriptions: number;
  totalRows: number;
  durationMs: number;
}

const SEED_SCENARIOS: Record<string, SeedScenario> = {
  minimal: {
    name: 'minimal',
    userCount: 5,
    artistCount: 2,
    trackCount: 10,
    tipCount: 20,
    subscriptionCount: 5,
    withStellarTransactions: false,
  },
  standard: {
    name: 'standard',
    userCount: 50,
    artistCount: 10,
    trackCount: 100,
    tipCount: 500,
    subscriptionCount: 30,
    withStellarTransactions: true,
  },
  load: {
    name: 'load',
    userCount: 500,
    artistCount: 100,
    trackCount: 2000,
    tipCount: 10000,
    subscriptionCount: 300,
    withStellarTransactions: true,
  },
};

const FAKE_STAGE_NAMES = [
  'Nova Stellar', 'Deep Tide', 'Luminary', 'Echo Pulse', 'Drift Wave',
  'Solar Flair', 'Apex Sound', 'Cosmic Thread', 'Neon Drift', 'The Voidcast',
];

const TRACK_TITLES = [
  'Midnight Protocol', 'Orbit Decay', 'Signal Loss', 'Resonant Field',
  'Gravity Well', 'Phase Shift', 'Dark Matter', 'Event Horizon', 'Stellar Wind',
  'Zero G', 'Pulsar Beat', 'Quantum Drift', 'Ion Storm', 'Binary Star',
  'Nebula Dive', 'Warp Core', 'Flux State', 'Void Echo', 'Photon Rain', 'Arc Light',
];

@Injectable()
export class TestDataGeneratorService {
  private readonly logger = new Logger(TestDataGeneratorService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  getScenario(scenarioName = 'standard'): SeedScenario {
    const scenario = SEED_SCENARIOS[scenarioName];
    if (!scenario) {
      this.logger.warn(`Unknown scenario "${scenarioName}", defaulting to "standard"`);
      return SEED_SCENARIOS['standard'];
    }
    return scenario;
  }

  tierToScenario(tier: SandboxTier): string {
    const map: Record<SandboxTier, string> = {
      [SandboxTier.BASIC]: 'minimal',
      [SandboxTier.STANDARD]: 'standard',
      [SandboxTier.FULL]: 'load',
    };
    return map[tier];
  }

  async generateAll(
    env: SandboxEnvironment,
    scenarioName?: string,
  ): Promise<GeneratedSeedSummary> {
    const start = Date.now();
    const scenario = this.getScenario(
      scenarioName ?? this.tierToScenario(env.tier),
    );

    this.logger.log(
      `Seeding sandbox "${env.name}" with scenario "${scenario.name}"`,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userIds = await this.seedUsers(queryRunner, env, scenario.userCount);
      const artistIds = await this.seedArtists(queryRunner, env, userIds, scenario.artistCount);
      const trackIds = await this.seedTracks(queryRunner, env, artistIds, scenario.trackCount);
      const tipCount = await this.seedTips(queryRunner, env, userIds, trackIds, scenario.tipCount);
      const subCount = await this.seedSubscriptions(
        queryRunner, env, userIds, artistIds, scenario.subscriptionCount,
      );

      await queryRunner.commitTransaction();

      const summary: GeneratedSeedSummary = {
        users: userIds.length,
        artists: artistIds.length,
        tracks: trackIds.length,
        tips: tipCount,
        subscriptions: subCount,
        totalRows: userIds.length + artistIds.length + trackIds.length + tipCount + subCount,
        durationMs: Date.now() - start,
      };

      this.logger.log(
        `Seeding complete for "${env.name}" in ${summary.durationMs}ms — ${summary.totalRows} rows`,
      );

      return summary;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Private seeders ───────────────────────────────────────────────────────

  private async seedUsers(
    queryRunner: any,
    env: SandboxEnvironment,
    count: number,
  ): Promise<string[]> {
    const ids: string[] = [];

    const values = Array.from({ length: count }, (_, i) => {
      const id = this.uuid();
      ids.push(id);
      const n = i + 1;
      return `(
        '${id}',
        '${env.schemaPrefix}user${n}@sandbox.test',
        '${env.schemaPrefix}_user_${n}',
        'Test User ${n}',
        '$2b$10$hashedpassword${n}placeholder',
        true,
        NOW(),
        NOW()
      )`;
    });

    if (values.length > 0) {
      await queryRunner.query(`
        INSERT INTO users
          (id, email, username, display_name, password_hash, is_verified, created_at, updated_at)
        VALUES ${values.join(',')}
        ON CONFLICT (email) DO NOTHING
      `);
    }

    return ids;
  }

  private async seedArtists(
    queryRunner: any,
    env: SandboxEnvironment,
    userIds: string[],
    count: number,
  ): Promise<string[]> {
    const artistUserIds = userIds.slice(0, Math.min(count, userIds.length));
    const ids: string[] = [];

    const values = artistUserIds.map((userId, i) => {
      const id = this.uuid();
      ids.push(id);
      const stageName = FAKE_STAGE_NAMES[i % FAKE_STAGE_NAMES.length];
      return `(
        '${id}',
        '${userId}',
        '${stageName} ${env.schemaPrefix.slice(-4)}',
        'Sandbox artist bio for testing integrations.',
        'GXXXXXXSTELLARPUBLICKEY${i}PLACEHOLDER',
        NOW(),
        NOW()
      )`;
    });

    if (values.length > 0) {
      await queryRunner.query(`
        INSERT INTO artists
          (id, user_id, stage_name, bio, stellar_address, created_at, updated_at)
        VALUES ${values.join(',')}
        ON CONFLICT DO NOTHING
      `);
    }

    return ids;
  }

  private async seedTracks(
    queryRunner: any,
    env: SandboxEnvironment,
    artistIds: string[],
    count: number,
  ): Promise<string[]> {
    const ids: string[] = [];

    const values = Array.from({ length: count }, (_, i) => {
      const id = this.uuid();
      ids.push(id);
      const artistId = artistIds[i % artistIds.length];
      const title = TRACK_TITLES[i % TRACK_TITLES.length];
      const durationSecs = 120 + Math.floor(Math.random() * 180);
      const priceXlm = (0.5 + Math.random() * 9.5).toFixed(2);

      return `(
        '${id}',
        '${artistId}',
        '${title} ${i + 1}',
        'https://sandbox-cdn.stellarswipe.test/tracks/${env.schemaPrefix}/track_${i + 1}.mp3',
        ${durationSecs},
        ${priceXlm},
        'XLM',
        true,
        NOW(),
        NOW()
      )`;
    });

    if (values.length > 0) {
      await queryRunner.query(`
        INSERT INTO tracks
          (id, artist_id, title, stream_url, duration_seconds, tip_price, tip_currency, is_published, created_at, updated_at)
        VALUES ${values.join(',')}
        ON CONFLICT DO NOTHING
      `);
    }

    return ids;
  }

  private async seedTips(
    queryRunner: any,
    env: SandboxEnvironment,
    userIds: string[],
    trackIds: string[],
    count: number,
  ): Promise<number> {
    const txHashes = new Set<string>();
    const values: string[] = [];

    for (let i = 0; i < count; i++) {
      const id = this.uuid();
      const fromUserId = userIds[i % userIds.length];
      const trackId = trackIds[i % trackIds.length];
      const amount = (0.5 + Math.random() * 49.5).toFixed(7);
      const txHash = this.mockStellarTxHash(txHashes);
      const statuses = ['completed', 'completed', 'completed', 'pending', 'failed'];
      const status = statuses[i % statuses.length];

      values.push(`(
        '${id}',
        '${fromUserId}',
        '${trackId}',
        ${amount},
        'XLM',
        '${txHash}',
        '${status}',
        NOW() - INTERVAL '${Math.floor(Math.random() * 30)} days',
        NOW()
      )`);
    }

    if (values.length > 0) {
      await queryRunner.query(`
        INSERT INTO tips
          (id, from_user_id, track_id, amount, currency, stellar_tx_hash, status, created_at, updated_at)
        VALUES ${values.join(',')}
        ON CONFLICT DO NOTHING
      `);
    }

    return values.length;
  }

  private async seedSubscriptions(
    queryRunner: any,
    _env: SandboxEnvironment,
    userIds: string[],
    artistIds: string[],
    count: number,
  ): Promise<number> {
    const seen = new Set<string>();
    const values: string[] = [];

    for (let i = 0; i < count; i++) {
      const userId = userIds[i % userIds.length];
      const artistId = artistIds[i % artistIds.length];
      const key = `${userId}:${artistId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const id = this.uuid();
      const plans = ['monthly', 'annual'];
      const plan = plans[i % plans.length];
      const renewAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      values.push(`(
        '${id}',
        '${userId}',
        '${artistId}',
        '${plan}',
        true,
        '${renewAt}',
        NOW(),
        NOW()
      )`);
    }

    if (values.length > 0) {
      await queryRunner.query(`
        INSERT INTO subscriptions
          (id, user_id, artist_id, plan, is_active, renews_at, created_at, updated_at)
        VALUES ${values.join(',')}
        ON CONFLICT DO NOTHING
      `);
    }

    return values.length;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private mockStellarTxHash(existing: Set<string>): string {
    let hash: string;
    do {
      hash = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16),
      ).join('').toUpperCase();
    } while (existing.has(hash));
    existing.add(hash);
    return hash;
  }
}
