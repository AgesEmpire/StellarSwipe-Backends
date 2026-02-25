import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';

describe('BackupService', () => {
  let service: BackupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config = {
                BACKUP_DIR: '/tmp/test-backups',
                DATABASE_HOST: 'localhost',
                DATABASE_PORT: 5432,
                DATABASE_NAME: 'test_db',
                DATABASE_USER: 'test_user',
                DATABASE_PASSWORD: 'test_pass',
                BACKUP_GPG_PASSPHRASE: 'test-passphrase',
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBackupStats', () => {
    it('should return backup statistics', async () => {
      const stats = await service.getBackupStats();
      expect(stats).toHaveProperty('totalBackups');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('backups');
    });
  });
});
