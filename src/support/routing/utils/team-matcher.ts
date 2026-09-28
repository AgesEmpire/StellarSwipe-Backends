import { Injectable } from '@nestjs/common';
import { SupportTeam } from '../entities/support-team.entity';
import { RoutingContext } from '../strategies/language-routing.strategy';
import { LanguageRoutingStrategy } from '../strategies/language-routing.strategy';
import { TimezoneRoutingStrategy } from '../strategies/timezone-routing.strategy';
import { SkillRoutingStrategy } from '../strategies/skill-routing.strategy';
import { LoadBalancingStrategy } from '../strategies/load-balancing.strategy';

const STRATEGY_WEIGHTS = {
  language: 0.35,
  timezone: 0.25,
  skill: 0.30,
  load_balance: 0.10,
};

export interface ScoredTeam {
  team: SupportTeam;
  score: number;
  breakdown: Record<string, number>;
}

@Injectable()
export class TeamMatcher {
  constructor(
    private languageStrategy: LanguageRoutingStrategy,
    private timezoneStrategy: TimezoneRoutingStrategy,
    private skillStrategy: SkillRoutingStrategy,
    private loadBalancingStrategy: LoadBalancingStrategy,
  ) {}

  scoreTeams(teams: SupportTeam[], context: RoutingContext): ScoredTeam[] {
    return teams.map((team) => {
      const breakdown = {
        language: this.languageStrategy.score(team, context),
        timezone: this.timezoneStrategy.score(team, context),
        skill: this.skillStrategy.score(team, context),
        load_balance: this.loadBalancingStrategy.score(team, context),
      };

      const score = Object.entries(breakdown).reduce(
        (total, [key, value]) => total + value * (STRATEGY_WEIGHTS[key as keyof typeof STRATEGY_WEIGHTS] ?? 0),
        0,
      );

      return { team, score, breakdown };
    });
  }

  findBestMatch(teams: SupportTeam[], context: RoutingContext): ScoredTeam | null {
    if (teams.length === 0) return null;
    const scored = this.scoreTeams(teams, context).sort((a, b) => b.score - a.score);
    return scored[0] ?? null;
  }
}
