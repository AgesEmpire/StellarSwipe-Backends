import { Server, Socket } from 'socket.io';
import { SocketManagerService } from './socket-manager.service';

function makeRemoteSockets(ids: string[]): Array<{ id: string }> {
  return ids.map((id) => ({ id }));
}

function makeServer(fetchSocketsResult: Array<{ id: string }>): {
  server: Server;
  inMock: jest.Mock;
  fetchSockets: jest.Mock;
} {
  const fetchSockets = jest.fn().mockResolvedValue(fetchSocketsResult);
  const inMock = jest.fn().mockReturnValue({ fetchSockets });
  const server = { in: inMock } as unknown as Server;
  return { server, inMock, fetchSockets };
}

describe('SocketManagerService', () => {
  let service: SocketManagerService;

  beforeEach(() => {
    service = new SocketManagerService();
  });

  describe('countActiveConnections', () => {
    it('returns 0 when the server has not been initialised yet', async () => {
      await expect(service.countActiveConnections('acct-1')).resolves.toBe(0);
    });

    it('counts every socket in the account room across the cluster', async () => {
      const { server } = makeServer(makeRemoteSockets(['s1', 's2', 's3']));
      service.setServer(server);

      await expect(service.countActiveConnections('acct-1')).resolves.toBe(3);
    });

    it('excludes the given socket id from the count', async () => {
      const { server } = makeServer(makeRemoteSockets(['s1', 's2', 's3']));
      service.setServer(server);

      await expect(
        service.countActiveConnections('acct-1', 's2'),
      ).resolves.toBe(2);
    });
  });

  describe('enforceConnectionLimit (issue #1386)', () => {
    const client = { id: 'new-socket' } as unknown as Socket;

    it('admits the connection when the account is under the cap', async () => {
      const { server } = makeServer(makeRemoteSockets(['s1', 's2']));
      service.setServer(server);

      await expect(
        service.enforceConnectionLimit('acct-1', client, 3),
      ).resolves.toBe(true);
    });

    it('rejects the connection once the account is at the cap', async () => {
      const { server } = makeServer(makeRemoteSockets(['s1', 's2', 's3']));
      service.setServer(server);
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await expect(
        service.enforceConnectionLimit('acct-1', client, 3),
      ).resolves.toBe(false);
    });

    it('rejects the connection when the account is already over the cap', async () => {
      const { server } = makeServer(makeRemoteSockets(['s1', 's2', 's3', 's4']));
      service.setServer(server);
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await expect(
        service.enforceConnectionLimit('acct-1', client, 3),
      ).resolves.toBe(false);
    });

    it('does not count the connecting socket itself against its own cap', async () => {
      // The connecting client already appears in fetchSockets() results in
      // some adapters/timings; it must still be excluded so a session isn't
      // penalized by its own in-flight connection.
      const { server } = makeServer(
        makeRemoteSockets(['s1', 's2', client.id]),
      );
      service.setServer(server);

      await expect(
        service.enforceConnectionLimit('acct-1', client, 2),
      ).resolves.toBe(true);
    });

    it('disables enforcement when maxConnections is 0 or negative', async () => {
      const { server } = makeServer(makeRemoteSockets(['s1', 's2', 's3', 's4', 's5']));
      service.setServer(server);

      await expect(
        service.enforceConnectionLimit('acct-1', client, 0),
      ).resolves.toBe(true);
      await expect(
        service.enforceConnectionLimit('acct-1', client, -1),
      ).resolves.toBe(true);
    });

    it('enforces the cap distributedly: a connection on another node still counts', async () => {
      // Simulates a clustered (e.g. Redis) adapter: fetchSockets() returns
      // sockets live on other processes, not just this one, so the cap
      // holds fleet-wide rather than per-node.
      const { server, inMock } = makeServer(
        makeRemoteSockets(['node-a-socket', 'node-b-socket']),
      );
      service.setServer(server);

      const allowed = await service.enforceConnectionLimit('acct-1', client, 2);

      expect(inMock).toHaveBeenCalledWith(service.getUserRoom('acct-1'));
      expect(allowed).toBe(false);
    });
  });
});
