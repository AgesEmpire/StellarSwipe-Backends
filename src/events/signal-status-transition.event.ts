import { BaseEvent } from './base.event';

export class SignalStatusTransitionEvent extends BaseEvent {
  readonly eventName = 'signal.status.transitioned';

  readonly signalId: string;
  readonly previousStatus: string;
  readonly newStatus: string;

  constructor(signalId: string, previousStatus: string, newStatus: string) {
    super();
    this.signalId = signalId;
    this.previousStatus = previousStatus;
    this.newStatus = newStatus;
  }

  validate(): void {}
}
