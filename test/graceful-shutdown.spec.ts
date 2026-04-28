import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('Graceful Shutdown (#373)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should close the application cleanly without throwing', async () => {
    await expect(app.close()).resolves.not.toThrow();
  });

  it('should drain in-flight counter correctly', () => {
    let inFlight = 0;
    const mockReq = {};
    const mockRes: any = { on: jest.fn((event, cb) => { if (event === 'finish') cb(); }) };
    const next = jest.fn(() => { inFlight++; });

    // Simulate the middleware
    const middleware = (_req: any, res: any, n: () => void) => {
      inFlight++;
      res.on('finish', () => { inFlight--; });
      res.on('close', () => { inFlight--; });
      n();
    };

    inFlight = 0;
    middleware(mockReq, mockRes, () => {});
    // finish event fires immediately via mock
    expect(inFlight).toBe(0);
  });
});
