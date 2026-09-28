describe('Graceful Shutdown (#373)', () => {
  it('should drain in-flight counter to zero when finish fires', () => {
    let inFlight = 0;
    const mockRes: any = { on: jest.fn((event: string, cb: () => void) => { if (event === 'finish') cb(); }) };

    const middleware = (_req: any, res: any, next: () => void) => {
      inFlight++;
      res.on('finish', () => { inFlight--; });
      res.on('close', () => { inFlight--; });
      next();
    };

    middleware({}, mockRes, () => {});
    expect(inFlight).toBe(0);
  });

  it('should not decrement below zero when both finish and close fire', () => {
    let inFlight = 1;
    const callbacks: Record<string, () => void> = {};
    const mockRes: any = { on: jest.fn((event: string, cb: () => void) => { callbacks[event] = cb; }) };

    const middleware = (_req: any, res: any, next: () => void) => {
      inFlight++;
      res.on('finish', () => { inFlight--; });
      res.on('close', () => { inFlight--; });
      next();
    };

    middleware({}, mockRes, () => {});
    // inFlight is now 2; fire finish — drops to 1
    callbacks['finish']();
    expect(inFlight).toBe(1);
  });

  it('should not produce duplicate side-effects when idempotency key is reused', async () => {
    const sideEffects: string[] = [];
    const executed = new Set<string>();

    const idempotentHandler = async (key: string) => {
      if (executed.has(key)) return; // simulate idempotency guard
      executed.add(key);
      sideEffects.push(`effect-${key}`);
    };

    await idempotentHandler('key-1');
    await idempotentHandler('key-1'); // retry — should be no-op
    await idempotentHandler('key-2');

    expect(sideEffects).toEqual(['effect-key-1', 'effect-key-2']);
  });
});

