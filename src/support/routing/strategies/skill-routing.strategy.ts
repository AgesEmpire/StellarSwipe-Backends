import { Injectable } from '@nestjs/common';
import { SupportTeam } from '../entities/support-team.entity';
import { RoutingContext, RoutingStrategy } from './language-routing.strategy';

@Injectable()
export class SkillRoutingStrategy implements RoutingStrategy {
  readonly name = 'skill';

  score(team: SupportTeam, context: RoutingContext): number {
    if (!context.requiredSkills || context.requiredSkills.length === 0) return 1;
    if (!team.skills || team.skills.length === 0) return 0;

    const teamSkillSet = new Set(team.skills.map((s) => s.toLowerCase()));
    const requiredSkills = context.requiredSkills.map((s) => s.toLowerCase());
    const matched = requiredSkills.filter((s) => teamSkillSet.has(s)).length;
    return matched / requiredSkills.length;
  }
}
