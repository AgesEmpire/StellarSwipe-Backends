import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TradeAuditController } from './trade-audit.controller';
import { TradeHistoryService } from './trade-history.service';
import { AuditService } from '../audit-log/audit.service';

const mockHistoryService = {
  getUserTradeHistory: jest.fn().mockResolvedValue({
    data: [],
    total: 0,
    limit: 20,
    offset: 0,
  }),
};

const mockAuditService = {
  query: jest.fn().mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    limit: 50,
    totalPages: 0,
  }),
};

const makeReq = (id: string, roles: string[] = []) => ({ user: { id, roles } });

describe('TradeAuditController', () => {
  let controller: TradeAuditController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradeAuditController],
      providers: [
        { provide: TradeHistoryService, useValue: mockHistoryService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    controller = module.get(TradeAuditController);
  });

  describe('getHistory', () => {
    it('returns trade history for the requesting user', async () => {
      const req = makeReq('user-1');
      const result = await controller.getHistory('user-1', {}, req);
      expect(result.data).toBeDefined();
      expect(mockHistoryService.getUserTradeHistory).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('throws ForbiddenException when user requests another user\'s history', async () => {
      const req = makeReq('user-2');
      await expect(controller.getHistory('user-1', {}, req)).rejects.toThrow(ForbiddenException);
    });

    it('allows admin to query any user\'s history', async () => {
      const req = makeReq('admin-1', ['admin']);
      await expect(controller.getHistory('user-1', {}, req)).resolves.not.toThrow();
    });

    it('passes date filters to the history service', async () => {
      const req = makeReq('user-1');
      await controller.getHistory(
        'user-1',
        { startDate: '2024-01-01', endDate: '2024-12-31', limit: 10, offset: 5 },
        req,
      );
      expect(mockHistoryService.getUserTradeHistory).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2024-01-01', endDate: '2024-12-31', limit: 10, offset: 5 }),
      );
    });
  });

  describe('getAuditTrail', () => {
    it('returns audit trail for the requesting user', async () => {
      const req = makeReq('user-1');
      const result = await controller.getAuditTrail('user-1', {}, req);
      expect(result.data).toBeDefined();
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('throws ForbiddenException when user requests another user\'s audit trail', async () => {
      const req = makeReq('user-2');
      await expect(controller.getAuditTrail('user-1', {}, req)).rejects.toThrow(ForbiddenException);
    });

    it('passes pagination params to audit service', async () => {
      const req = makeReq('user-1');
      await controller.getAuditTrail('user-1', { page: 2, limit: 25 }, req);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 25 }),
      );
    });
  });
});
