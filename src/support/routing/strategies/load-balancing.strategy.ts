import { Injectable } from '@nestjs/common';
import { SupportTeam } from '../entities/support-team.entity';
import { RoutingContext, RoutingStrategy } from './language-routing.strategy';

@Injectable()
export class LoadBalancingStrategy implements RoutingStrategy {
  readonly name = 'load_balance';

  score(team: SupportTeam, _context: RoutingContext): number {
    if (team.maxCapacity === 0) return 0;
    const utilization = team.currentLoad / team.maxCapacity;
    if (utilization >= 1) return 0;
    return 1 - utilization;
  }

  isAtCapacity(team: SupportTeam): boolean {
    return team.currentLoad >= team.maxCapacity;
  }
}
