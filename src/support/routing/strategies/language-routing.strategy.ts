import { Injectable } from '@nestjs/common';
import { SupportTeam } from '../entities/support-team.entity';

export interface RoutingContext {
  language?: string;
  region?: string;
  timezone?: string;
  requiredSkills?: string[];
}

export interface RoutingStrategy {
  name: string;
  score(team: SupportTeam, context: RoutingContext): number;
}

@Injectable()
export class LanguageRoutingStrategy implements RoutingStrategy {
  readonly name = 'language';

  score(team: SupportTeam, context: RoutingContext): number {
    if (!context.language) return 0.5;
    const lang = context.language.toLowerCase().split('-')[0];
    const supported = team.languages.map((l) => l.toLowerCase().split('-')[0]);
    if (supported.includes(lang)) return 1;
    if (supported.includes('en') && lang !== 'en') return 0.3;
    return 0;
  }
}
