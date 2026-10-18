import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { SocketEvent, SocketRoom, contestLeaderboardRoom } from '../dto/socket-event.dto';

const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 65000;

/** Default cap on concurrent WebSocket connections a single account may hold at once. */
const DEFAULT_MAX_CONNECTIONS_PER_ACCOUNT = 5;

/**
 * Per-account concurrent connection cap, configurable via env so gateway
 * capacity can be tuned without a code change. `0` or a negative value
 * disables enforcement entirely.
 */
export const WS_MAX_CONNECTIONS_PER_ACCOUNT = Number(
  process.env.WS_MAX_CONNECTIONS_PER_ACCOUNT ?? DEFAULT_MAX_CONNECTIONS_PER_ACCOUNT,
);

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

  /**
   * Whether the user has at least one authenticated socket in their private room.
   * Uses fetchSockets so it works across nodes when a clustered adapter is configured.
   */
  async isUserOnline(userId: string): Promise<boolean> {
    if (!this.server) {
      return false;
    }
    const sockets = await this.server.in(this.getUserRoom(userId)).fetchSockets();
    return sockets.length > 0;
  }

  /**
   * Counts the account's currently-admitted connections, excluding `client`
   * itself (it has not joined its account room yet at connection time).
   * Reads through `fetchSockets()` on the account room, so — with a
   * clustered adapter (e.g. Redis) configured — the count reflects every
   * node in the fleet, not just this process. Falls back to `0` before the
   * server is initialised, which only matters in tests.
   */
  async countActiveConnections(accountId: string, excludeSocketId?: string): Promise<number> {
    if (!this.server) {
      return 0;
    }
    const sockets = await this.server.in(this.getUserRoom(accountId)).fetchSockets();
    return excludeSocketId
      ? sockets.filter((socket) => socket.id !== excludeSocketId).length
      : sockets.length;
  }

  /**
   * Enforces the per-account concurrent connection cap (issue #1386).
   * Returns `true` when `client` may proceed to join its account room,
   * `false` when the account is already at or above `maxConnections` and
   * the caller should reject/close this connection instead.
   *
   * Passing `maxConnections <= 0` disables enforcement.
   */
  async enforceConnectionLimit(
    accountId: string,
    client: Socket,
    maxConnections: number = WS_MAX_CONNECTIONS_PER_ACCOUNT,
  ): Promise<boolean> {
    if (maxConnections <= 0) {
      return true;
    }

    const activeCount = await this.countActiveConnections(accountId, client.id);
    if (activeCount >= maxConnections) {
      this.logger.warn(
        `Rejecting WS connection ${client.id} for account ${accountId}: ` +
          `${activeCount} active connections already at or above limit ${maxConnections}`,
      );
      return false;
    }

    return true;
  }

  emitNotification(userId: string, payload: unknown): void {
    if (!this.server) {
      throw new Error('WebSocket server not initialised');
    }
    this.server.to(this.getUserRoom(userId)).emit(SocketEvent.NOTIFICATION, payload);
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
