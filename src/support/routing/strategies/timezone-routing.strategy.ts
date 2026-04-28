import { Injectable } from '@nestjs/common';
import { SupportTeam } from '../entities/support-team.entity';
import { RoutingContext, RoutingStrategy } from './language-routing.strategy';

@Injectable()
export class TimezoneRoutingStrategy implements RoutingStrategy {
  readonly name = 'timezone';

  score(team: SupportTeam, context: RoutingContext): number {
    if (!context.timezone) return 0.5;

    const userOffset = this.getUtcOffset(context.timezone);
    const teamOffset = this.getUtcOffset(team.timezone);

    if (userOffset === null || teamOffset === null) return 0.5;

    const diff = Math.abs(userOffset - teamOffset);
    // Perfect match = 1.0, 12h diff = 0.0
    return Math.max(0, 1 - diff / 12);
  }

  private getUtcOffset(timezone: string): number | null {
    try {
      const date = new Date();
      const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
      return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60 * 60);
    } catch {
      return null;
    }
  }
}
