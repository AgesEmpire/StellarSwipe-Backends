import { Injectable } from '@nestjs/common';
import { RecurrenceType } from '../entities/scheduled-trade.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class TimeConditionEvaluator {
  isTimeReached(executeAt: Date): boolean {
    return new Date() >= new Date(executeAt);
  }

  isRecurrenceTime(
    recurTime: string,
    recurrence: RecurrenceType,
    lastExecutedAt?: Date,
  ): boolean {
    const now = new Date();
    const [hours, minutes] = recurTime.split(':').map(Number);

    const isCorrectTime =
      now.getHours() === hours && now.getMinutes() === minutes;

    if (!isCorrectTime) {
      return false;
    }

    if (!lastExecutedAt) {
      return true;
    }

    const msSinceLast = now.getTime() - new Date(lastExecutedAt).getTime();

    if (recurrence === RecurrenceType.DAILY) {
      return msSinceLast >= MS_PER_DAY;
    }

    if (recurrence === RecurrenceType.WEEKLY) {
      return msSinceLast >= 7 * MS_PER_DAY;
    }

    return false;
  }
}
