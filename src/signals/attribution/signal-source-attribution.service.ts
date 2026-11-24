import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignalSourceAttribution } from './signal-source-attribution.entity';

export interface AttributionSourceInput {
  sourceId: string;
  sourceType: string;
  contributionWeight: number;
  publicLabel?: string | null;
  isPublic?: boolean;
  contributionMetadata?: Record<string, unknown> | null;
}

/** Only these fields leave the service in public responses. */
export interface PublicAttributionSource {
  sourceType: string;
  label: string;
  contributionWeight: number;
}

export interface PublicAttribution {
  signalId: string;
  signalVersion: number;
  sources: PublicAttributionSource[];
  /** Combined weight of sources not approved for public naming. */
  undisclosedWeight: number;
}

const WEIGHT_TOLERANCE = 1e-6;
const PG_UNIQUE_VIOLATION = '23505';
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

@Injectable()
export class SignalSourceAttributionService {
  constructor(
    @InjectRepository(SignalSourceAttribution)
    private readonly repo: Repository<SignalSourceAttribution>,
  ) {}

  /**
   * Snapshot the attribution for a published signal version. Inputs are deep-
   * copied, so later mutation of provider objects cannot change history. Each
   * version's attribution can be written exactly once.
   */
  async recordForVersion(
    signalId: string,
    signalVersion: number,
    sources: AttributionSourceInput[],
  ): Promise<SignalSourceAttribution[]> {
    this.validate(signalVersion, sources);

    const existing = await this.repo.count({ where: { signalId, signalVersion } });
    if (existing > 0) {
      throw new ConflictException(
        `Attribution for signal ${signalId} version ${signalVersion} is immutable`,
      );
    }

    const latest = await this.latestVersion(signalId);
    if (latest !== null && signalVersion <= latest) {
      throw new ConflictException(
        `Attribution version ${signalVersion} must be newer than ${latest}`,
      );
    }

    const rows = sources.map((s) =>
      this.repo.create({
        signalId,
        signalVersion,
        sourceId: s.sourceId,
        sourceType: s.sourceType,
        publicLabel: s.publicLabel ?? null,
        isPublic: s.isPublic ?? false,
        contributionWeight: round6(s.contributionWeight).toFixed(6),
        contributionMetadata: s.contributionMetadata
          ? JSON.parse(JSON.stringify(s.contributionMetadata))
          : null,
      }),
    );

    try {
      return await this.repo.save(rows);
    } catch (err) {
      if ((err as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          `Attribution for signal ${signalId} version ${signalVersion} already recorded`,
        );
      }
      throw err;
    }
  }

  /** Correction: a new version with a fully restated attribution set. */
  async recordCorrection(
    signalId: string,
    newVersion: number,
    sources: AttributionSourceInput[],
  ): Promise<SignalSourceAttribution[]> {
    await this.requireVersion(signalId);
    return this.recordForVersion(signalId, newVersion, sources);
  }

  /**
   * Remove an upstream source going forward: copies the latest version's set
   * minus that source, renormalising the remaining weights. Prior versions
   * keep the removed source untouched.
   */
  async removeSource(
    signalId: string,
    newVersion: number,
    sourceId: string,
  ): Promise<SignalSourceAttribution[]> {
    const current = await this.getForVersion(signalId);
    const remaining = current.filter((r) => r.sourceId !== sourceId);
    if (remaining.length === current.length) {
      throw new NotFoundException(`Source ${sourceId} is not attributed to signal ${signalId}`);
    }
    if (remaining.length === 0) {
      throw new BadRequestException('Cannot remove the only attributed source');
    }

    const total = remaining.reduce((sum, r) => sum + Number(r.contributionWeight), 0);
    const inputs = remaining.map((r) => ({
      sourceId: r.sourceId,
      sourceType: r.sourceType,
      publicLabel: r.publicLabel,
      isPublic: r.isPublic,
      contributionMetadata: r.contributionMetadata,
      contributionWeight: Number(r.contributionWeight) / total,
    }));
    // Absorb rounding drift into the largest share so weights sum to exactly 1.
    const rounded = inputs.map((i) => round6(i.contributionWeight));
    const drift = round6(1 - rounded.reduce((a, b) => a + b, 0));
    const largest = rounded.indexOf(Math.max(...rounded));
    rounded[largest] = round6(rounded[largest] + drift);
    inputs.forEach((i, idx) => (i.contributionWeight = rounded[idx]));

    return this.recordForVersion(signalId, newVersion, inputs);
  }

  /** Internal view for a version (latest when omitted). */
  async getForVersion(signalId: string, signalVersion?: number): Promise<SignalSourceAttribution[]> {
    const version = signalVersion ?? (await this.requireVersion(signalId));
    const rows = await this.repo.find({
      where: { signalId, signalVersion: version },
      order: { contributionWeight: 'DESC', sourceId: 'ASC' },
    });
    if (rows.length === 0) {
      throw new NotFoundException(
        `No attribution recorded for signal ${signalId} version ${version}`,
      );
    }
    return rows;
  }

  async getPublicAttribution(signalId: string, signalVersion?: number): Promise<PublicAttribution> {
    const rows = await this.getForVersion(signalId, signalVersion);
    return SignalSourceAttributionService.toPublic(rows);
  }

  /** Whitelist projection: never leaks sourceId or contributionMetadata. */
  static toPublic(rows: SignalSourceAttribution[]): PublicAttribution {
    const disclosed = rows.filter((r) => r.isPublic && r.publicLabel);
    const undisclosed = rows.filter((r) => !(r.isPublic && r.publicLabel));
    return {
      signalId: rows[0].signalId,
      signalVersion: rows[0].signalVersion,
      sources: disclosed.map((r) => ({
        sourceType: r.sourceType,
        label: r.publicLabel as string,
        contributionWeight: Number(r.contributionWeight),
      })),
      undisclosedWeight: round6(
        undisclosed.reduce((sum, r) => sum + Number(r.contributionWeight), 0),
      ),
    };
  }

  private async latestVersion(signalId: string): Promise<number | null> {
    const latest = await this.repo.findOne({
      where: { signalId },
      order: { signalVersion: 'DESC' },
    });
    return latest ? latest.signalVersion : null;
  }

  private async requireVersion(signalId: string): Promise<number> {
    const v = await this.latestVersion(signalId);
    if (v === null) throw new NotFoundException(`No attribution recorded for signal ${signalId}`);
    return v;
  }

  private validate(signalVersion: number, sources: AttributionSourceInput[]): void {
    if (!Number.isInteger(signalVersion) || signalVersion < 1) {
      throw new BadRequestException('signalVersion must be a positive integer');
    }
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new BadRequestException('At least one attribution source is required');
    }
    const ids = new Set<string>();
    for (const s of sources) {
      if (!s.sourceId || !s.sourceType) {
        throw new BadRequestException('sourceId and sourceType are required');
      }
      if (ids.has(s.sourceId)) throw new BadRequestException(`Duplicate source ${s.sourceId}`);
      ids.add(s.sourceId);
      if (!(s.contributionWeight > 0 && s.contributionWeight <= 1)) {
        throw new BadRequestException('contributionWeight must be in (0, 1]');
      }
    }
    const total = sources.reduce((sum, s) => sum + s.contributionWeight, 0);
    if (Math.abs(total - 1) > WEIGHT_TOLERANCE) {
      throw new BadRequestException(`Contribution weights must sum to 1 (got ${round6(total)})`);
    }
  }
}
