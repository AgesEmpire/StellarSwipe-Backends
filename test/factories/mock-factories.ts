/**
 * Shared mock factories for unit tests, so tests stop hand-rolling
 * ad-hoc repository/http/queue/auth mocks that drift from the real
 * service contracts.
 */

export interface MockRepository<T = any> {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
}

export function createMockRepository<T = any>(): MockRepository<T> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    create: jest.fn().mockImplementation((entity) => entity),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
  };
}

export interface MockHttpClient {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
}

export function createMockHttpClient(): MockHttpClient {
  return {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    patch: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  };
}

export interface MockQueue {
  add: jest.Mock;
  process: jest.Mock;
  getJob: jest.Mock;
  removeJobs: jest.Mock;
}

export function createMockQueue(): MockQueue {
  return {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    process: jest.fn(),
    getJob: jest.fn().mockResolvedValue(null),
    removeJobs: jest.fn().mockResolvedValue(undefined),
  };
}

export interface MockAuthService {
  validateUser: jest.Mock;
  signAccessToken: jest.Mock;
  verifyAccessToken: jest.Mock;
}

export function createMockAuthService(): MockAuthService {
  return {
    validateUser: jest.fn().mockResolvedValue({ id: 'mock-user-id' }),
    signAccessToken: jest.fn().mockReturnValue('mock-access-token'),
    verifyAccessToken: jest.fn().mockReturnValue({ sub: 'mock-user-id' }),
  };
}
