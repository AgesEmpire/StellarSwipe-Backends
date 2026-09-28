import {
  createMockRepository,
  createMockHttpClient,
  createMockQueue,
  createMockAuthService,
} from './mock-factories';

describe('shared mock factories', () => {
  it('creates a repository mock with default resolved behavior', async () => {
    const repo = createMockRepository();
    await expect(repo.find()).resolves.toEqual([]);
    await expect(repo.findOne()).resolves.toBeNull();
    await expect(repo.save({ id: 1 })).resolves.toEqual({ id: 1 });
  });

  it('creates an http client mock with default resolved behavior', async () => {
    const http = createMockHttpClient();
    await expect(http.get()).resolves.toEqual({ data: {} });
  });

  it('creates a queue mock with default resolved behavior', async () => {
    const queue = createMockQueue();
    await expect(queue.add()).resolves.toEqual({ id: 'mock-job-id' });
  });

  it('creates an auth service mock with default resolved behavior', async () => {
    const auth = createMockAuthService();
    await expect(auth.validateUser()).resolves.toEqual({
      id: 'mock-user-id',
    });
    expect(auth.signAccessToken()).toBe('mock-access-token');
  });
});
