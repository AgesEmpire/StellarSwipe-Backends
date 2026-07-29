import { SorobanException } from '../exceptions/soroban-exception';
import { SorobanExceptionFilter } from './soroban-exception.filter';

describe('SorobanExceptionFilter', () => {
  let filter: SorobanExceptionFilter;

  beforeEach(() => {
    filter = new SorobanExceptionFilter();
  });

  function mockHost(payload: any) {
    const req: any = { url: '/test', headers: {} };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any;
  }

  it('maps unauthorized soroban error to 403', () => {
    const ex = new SorobanException('Auth failed', 'C1', 'method', { code: 'unauthorized' });
    const host = mockHost(ex);
    filter.catch(ex, host);
    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.errorCode).toBeDefined();
    expect(body.statusCode).toBe(403);
  });

  it('maps invalid-args soroban error to 422', () => {
    const ex = new SorobanException('Invalid args', 'C1', 'method', { code: 'invalid_args' });
    const host = mockHost(ex);
    filter.catch(ex, host);
    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(422);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toMatch(/Invalid contract arguments/i);
  });

  it('maps rpc/internal soroban error to 502', () => {
    const ex = new SorobanException('Node failed', 'C1', 'method', { error: 'rpc_internal_error' });
    const host = mockHost(ex);
    filter.catch(ex, host);
    const res = host.switchToHttp().getResponse();
    expect(res.status).toHaveBeenCalledWith(502);
    const body = res.json.mock.calls[0][0];
    expect(body.errorCode).toBeDefined();
    expect(body.statusCode).toBe(502);
  });
});
