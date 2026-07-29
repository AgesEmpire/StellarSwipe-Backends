import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketEvent, SocketRoom, contestLeaderboardRoom } from '../dto/socket-event.dto';

const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 65000;

@Injectable()
export class SocketManagerService {
  private readonly logger = new Logger(SocketManagerService.name);
  private server?: Server;
  private readonly heartbeatIntervals = new Map<string, NodeJS.Timeout>();
  private readonly lastPongAt = new Map<string, number>();

  setServer(server: Server): void {
    this.server = server;
  }

  getUserRoom(walletAddress: string): string {
    return `user:${walletAddress}`;
  }

  registerClient(client: Socket): void {
    this.lastPongAt.set(client.id, Date.now());
    client.on('pong', () => {
      this.lastPongAt.set(client.id, Date.now());
    });
    this.startHeartbeat(client);
  }

  unregisterClient(client: Socket): void {
    const interval = this.heartbeatIntervals.get(client.id);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(client.id);
    }
    this.lastPongAt.delete(client.id);
  }

  emitTradeUpdated(walletAddress: string, payload: unknown): void {
    this.server
      ?.to(this.getUserRoom(walletAddress))
      .emit(SocketEvent.TRADE_UPDATED, payload);
  }

  emitSignalPerformance(walletAddress: string, payload: unknown): void {
    this.server
      ?.to(this.getUserRoom(walletAddress))
      .emit(SocketEvent.SIGNAL_PERFORMANCE, payload);
  }

  emitPortfolioChanged(walletAddress: string, payload: unknown): void {
    this.server
      ?.to(this.getUserRoom(walletAddress))
      .emit(SocketEvent.PORTFOLIO_CHANGED, payload);
  }

  emitNewSignal(payload: unknown): void {
    this.server?.to(SocketRoom.SIGNALS_FEED).emit(SocketEvent.NEW_SIGNAL, payload);
  }

  emitContestLeaderboard(contestId: string, payload: unknown): void {
    this.server
      ?.to(contestLeaderboardRoom(contestId))
      .emit(SocketEvent.CONTEST_LEADERBOARD_UPDATED, payload);
  }

  private startHeartbeat(client: Socket): void {
    if (this.heartbeatIntervals.has(client.id)) {
      return;
    }

    const interval = setInterval(() => {
      const lastPong = this.lastPongAt.get(client.id) ?? 0;
      if (Date.now() - lastPong > HEARTBEAT_TIMEOUT_MS) {
        this.logger.warn(`Heartbeat timeout for socket ${client.id}`);
        client.disconnect(true);
        return;
      }
      client.emit('ping', { timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatIntervals.set(client.id, interval);
  }
}
