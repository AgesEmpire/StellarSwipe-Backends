import { PeerGroup } from '../entities/peer-group.entity';

export interface ProviderProfile {
  providerId: string;
  assetClass?: string;
  strategyType?: string;
  aum?: number;
  vintage?: number;
  region?: string;
  [key: string]: any;
}

export interface MatchScore {
  providerId: string;
  score: number;
  matchedCriteria: string[];
}

export class PeerMatcher {
  private static readonly EXACT_MATCH_SCORE = 40;
  private static readonly RANGE_MATCH_SCORE = 25;
  private static readonly PARTIAL_MATCH_SCORE = 10;
  private static readonly MIN_MATCH_SCORE = 50;

  /**
   * Find peers from a pool of provider profiles that best match the subject.
   */
  static findPeers(
    subject: ProviderProfile,
    pool: ProviderProfile[],
    peerGroup?: PeerGroup,
  ): string[] {
    if (peerGroup) {
      return peerGroup.providerIds.filter((id) => id !== subject.providerId);
    }

    const scores = pool
      .filter((p) => p.providerId !== subject.providerId)
      .map((p) => this.scoreMatch(subject, p))
      .filter((s) => s.score >= this.MIN_MATCH_SCORE)
      .sort((a, b) => b.score - a.score);

    return scores.map((s) => s.providerId);
  }

  /**
   * Derive a group key from a provider's profile for dynamic peer grouping.
   */
  static deriveGroupKey(profile: ProviderProfile): string {
    const parts: string[] = [];
    if (profile.assetClass) parts.push(profile.assetClass.toLowerCase());
    if (profile.strategyType) parts.push(profile.strategyType.toLowerCase());
    if (profile.region) parts.push(profile.region.toLowerCase());
    if (profile.aum !== undefined) parts.push(this.aumBucket(profile.aum));
    return parts.join(':') || 'general';
  }

  /**
   * Score how well two provider profiles match across known dimensions.
   */
  private static scoreMatch(
    a: ProviderProfile,
    b: ProviderProfile,
  ): MatchScore {
    let score = 0;
    const matched: string[] = [];

    // Exact match fields
    for (const field of ['assetClass', 'strategyType', 'region']) {
      if (a[field] && b[field] && a[field] === b[field]) {
        score += this.EXACT_MATCH_SCORE;
        matched.push(field);
      }
    }

    // AUM range match
    if (a.aum !== undefined && b.aum !== undefined) {
      const ratio = Math.min(a.aum, b.aum) / Math.max(a.aum, b.aum);
      if (ratio >= 0.5) {
        score += this.RANGE_MATCH_SCORE;
        matched.push('aum');
      }
    }

    // Vintage proximity (within 3 years)
    if (a.vintage !== undefined && b.vintage !== undefined) {
      if (Math.abs(a.vintage - b.vintage) <= 3) {
        score += this.PARTIAL_MATCH_SCORE;
        matched.push('vintage');
      }
    }

    return { providerId: b.providerId, score, matchedCriteria: matched };
  }

  private static aumBucket(aum: number): string {
    if (aum < 1_000_000) return 'micro';
    if (aum < 10_000_000) return 'small';
    if (aum < 100_000_000) return 'mid';
    if (aum < 1_000_000_000) return 'large';
    return 'mega';
  }
}
