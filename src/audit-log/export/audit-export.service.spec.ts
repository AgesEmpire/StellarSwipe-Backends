import { Test, TestingModule } from '@nestjs/testing';
import { AuditExportService } from './audit-export.service';
import { getQueueToken } from '@nestjs/bull';

describe('AuditExportService', () => {
  let service: AuditExportService;
  let queueMock: any;

  beforeEach(async () => {
    queueMock = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditExportService,
        {
          provide: getQueueToken('audit-export'),
          useValue: queueMock,
        },
      ],
    }).compile();

    service = module.get<AuditExportService>(AuditExportService);
  });

  it('should request export', async () => {
    const dto = { startDate: '2023-01-01', endDate: '2023-12-31' };
    const result = await service.requestExport(dto);
    
    expect(queueMock.add).toHaveBeenCalled();
    expect(result.status).toEqual('PENDING');
    expect(result.jobId).toBeDefined();
  });

  it('should generate download link', () => {
    const link = service.getDownloadLink('123');
    expect(link).toEqual('/api/v1/audit/export/download/123');
  });
});
