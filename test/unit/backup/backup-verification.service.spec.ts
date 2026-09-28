import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BackupVerificationService } from '../../../src/backup/backup-verification.service';
import { BackupService } from '../../../src/backup/backup.service';

describe('BackupVerificationService', () => {
  let service: BackupVerificationService;
  let configService: jest.Mocked<ConfigService>;
  let backupService: jest.Mocked<BackupService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config = {
          TEST_DATABASE_NAME: 'test_restore_db',
          BACKUP_DIR: '/tmp/test-backups',
          BACKUP_GPG_PASSPHRASE: 'test-passphrase',
          DATABASE_HOST: 'localhost',
          DATABASE_PORT: 5432,
          DATABASE_USER: 'postgres',
          DATABASE_PASSWORD: 'password',
        };
        return config[key] || defaultValue;
      }),
    };

    const mockBackupService = {
      createBackup: jest.fn(),
      restoreBackup: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupVerificationService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: BackupService,
          useValue: mockBackupService,
        },
      ],
    }).compile();

    service = module.get<BackupVerificationService>(BackupVerificationService);
    configService = module.get(ConfigService);
    backupService = module.get(BackupService);
  });

  describe('verifyBackup', () => {
    it('should return verification result structure', async () => {
      const mockBackupPath = '/tmp/test-backup.sql.gz.gpg';
      
      const result = await service.verifyBackup(mockBackupPath);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('backupFile', mockBackupPath);
      expect(result).toHaveProperty('verificationDetails');
      expect(result.verificationDetails).toHaveProperty('fileIntegrity');
      expect(result.verificationDetails).toHaveProperty('decryptionTest');
      expect(result.verificationDetails).toHaveProperty('decompressionTest');
      expect(result.verificationDetails).toHaveProperty('sqlValidation');
      expect(result.verificationDetails).toHaveProperty('sampleDataCheck');
    });

    it('should handle verification errors gracefully', async () => {
      const mockBackupPath = '/nonexistent/backup.sql.gz.gpg';
      
      const result = await service.verifyBackup(mockBackupPath);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getVerificationLogs', () => {
    it('should return verification logs array', async () => {
      const logs = await service.getVerificationLogs();

      expect(Array.isArray(logs)).toBe(true);
    });
  });
});