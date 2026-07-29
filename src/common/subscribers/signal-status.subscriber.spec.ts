import { SignalStatusSubscriber } from './signal-status.subscriber';
import { SignalStatus } from '../../signals/entities/signal.entity';

const mockDataSource = { subscribers: [] } as any;
const mockEventEmitter = { emit: jest.fn() };

const makeSubscriber = () =>
  new SignalStatusSubscriber(mockDataSource, mockEventEmitter as any);

const makeEvent = (prevStatus: string, nextStatus: string) => ({
  entity: { id: 'sig-1', status: nextStatus as SignalStatus },
  databaseEntity: { id: 'sig-1', status: prevStatus as SignalStatus },
});

describe('SignalStatusSubscriber', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits domain event on status change', () => {
    const subscriber = makeSubscriber();
    subscriber.afterUpdate(makeEvent('ACTIVE', 'EXPIRED') as any);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'signal.status.transitioned',
      expect.objectContaining({ signalId: 'sig-1', previousStatus: 'ACTIVE', newStatus: 'EXPIRED' }),
    );
  });

  it('does NOT emit when status is unchanged', () => {
    const subscriber = makeSubscriber();
    subscriber.afterUpdate(makeEvent('ACTIVE', 'ACTIVE') as any);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when entity or databaseEntity is missing', () => {
    const subscriber = makeSubscriber();
    subscriber.afterUpdate({ entity: null, databaseEntity: null } as any);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });
});
