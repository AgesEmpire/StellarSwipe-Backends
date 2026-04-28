import { Injectable } from '@nestjs/common';
import { SupportTeam } from '../entities/support-team.entity';

interface WorkingHourSlot {
  start: string;
  end: string;
}

interface WorkingHoursSchedule {
  [day: string]: WorkingHourSlot | null;
}

@Injectable()
export class AvailabilityChecker {
  isTeamAvailable(team: SupportTeam, atTime: Date = new Date()): boolean {
    if (!team.isActive) return false;
    if (team.currentLoad >= team.maxCapacity) return false;

    const schedule = team.workingHours as WorkingHoursSchedule;
    if (!schedule || Object.keys(schedule).length === 0) return true;

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    try {
      const localTime = new Date(atTime.toLocaleString('en-US', { timeZone: team.timezone }));
      const dayKey = dayNames[localTime.getDay()];
      const slot = schedule[dayKey];

      if (!slot) return false;

      const [startH, startM] = slot.start.split(':').map(Number);
      const [endH, endM] = slot.end.split(':').map(Number);
      const currentMinutes = localTime.getHours() * 60 + localTime.getMinutes();
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } catch {
      return true;
    }
  }

  filterAvailable(teams: SupportTeam[], atTime?: Date): SupportTeam[] {
    return teams.filter((t) => this.isTeamAvailable(t, atTime));
  }

  getCapacityRatio(team: SupportTeam): number {
    if (team.maxCapacity === 0) return 1;
    return team.currentLoad / team.maxCapacity;
  }
}
