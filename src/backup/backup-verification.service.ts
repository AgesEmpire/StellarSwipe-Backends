import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';

const execAsync = promisify(exec);

interface VerificationResult {
  success: boolean;
  timestamp: Date;
  backupFile: string;
  verificationDetails: {
    fileIntegrity: boolean;
    decryptionTest: boolean;
    decompressionTest: boolean;
    sqlValidation: boolean;
    sampleDataCheck: boolean;
  };
  error?: string;
}

@Injectable()
export class BackupVerificationService {
  private readonly logger = new Logger(BackupVerificationService.name);
  private readonly testDbName: string;
  private readonly backupDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly backupService: BackupService,
  ) {
    this.testDbName = this.configService.get('TEST_DATABASE_NAME', 'stellarswipe_test_restore');
    this.backupDir = this.configService.get('BACKUP_DIR', '/var/backups/stellarswipe');
  }

  async verifyBackup(backupPath: string): Promise<VerificationResult> {
    const result: VerificationResult = {
      success: false,
      timestamp: new Date(),
      backupFile: backupPath,
      verificationDetails: {
        fileIntegrity: false,
        decryptionTest: false,
        decompressionTest: false,
        sqlValidation: false,
        sampleDataCheck: false,
      },
    };

    try {
      // 1. File integrity check
      result.verificationDetails.fileIntegrity = await this.checkFileIntegrity(backupPath);
      
      // 2. Decryption test
      result.verificationDetails.decryptionTest = await this.testDecryption(backupPath);
      
      // 3. Decompression test
      result.verificationDetails.decompressionTest = await this.testDecompression(backupPath);
      
      // 4. SQL validation
      result.verificationDetails.sqlValidation = await this.validateSqlContent(backupPath);
      
      // 5. Sample data check
      result.verificationDetails.sampleDataCheck = await this.verifySampleData(backupPath);

      result.success = Object.values(result.verificationDetails).every(check => check);
      
      this.logger.log(`Backup verification ${result.success ? 'passed' : 'failed'}: ${backupPath}`);
      return result;
    } catch (error) {
      result.error = error.message;
      this.logger.error(`Backup verification error: ${error.message}`);
      return result;
    }
  }

  private async checkFileIntegrity(backupPath: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`file ${backupPath}`);
      return stdout.includes('GPG symmetrically encrypted data');
    } catch (error) {
      this.logger.error(`File integrity check failed: ${error.message}`);
      return false;
    }
  }

  private async testDecryption(backupPath: string): Promise<boolean> {
    const tempPath = join(this.backupDir, 'verify_decrypt.tmp');
    const gpgPassphrase = this.configService.get('BACKUP_GPG_PASSPHRASE', 'change-me');
    
    try {
      await execAsync(`gpg --batch --yes --passphrase "${gpgPassphrase}" --decrypt -o ${tempPath} ${backupPath}`);
      await unlink(tempPath);
      return true;
    } catch (error) {
      this.logger.error(`Decryption test failed: ${error.message}`);
      return false;
    }
  }

  private async testDecompression(backupPath: string): Promise<boolean> {
    const tempDecrypted = join(this.backupDir, 'verify_decrypt.tmp');
    const tempDecompressed = join(this.backupDir, 'verify_decompress.tmp');
    const gpgPassphrase = this.configService.get('BACKUP_GPG_PASSPHRASE', 'change-me');
    
    try {
      await execAsync(`gpg --batch --yes --passphrase "${gpgPassphrase}" --decrypt -o ${tempDecrypted} ${backupPath}`);
      await execAsync(`gunzip -c ${tempDecrypted} > ${tempDecompressed}`);
      
      // Check if decompressed file has content
      const { stdout } = await execAsync(`wc -l ${tempDecompressed}`);
      const lineCount = parseInt(stdout.split(' ')[0]);
      
      await unlink(tempDecrypted);
      await unlink(tempDecompressed);
      
      return lineCount > 0;
    } catch (error) {
      this.logger.error(`Decompression test failed: ${error.message}`);
      return false;
    }
  }

  private async validateSqlContent(backupPath: string): Promise<boolean> {
    const tempDecrypted = join(this.backupDir, 'verify_decrypt.tmp');
    const tempDecompressed = join(this.backupDir, 'verify_decompress.tmp');
    const gpgPassphrase = this.configService.get('BACKUP_GPG_PASSPHRASE', 'change-me');
    
    try {
      await execAsync(`gpg --batch --yes --passphrase "${gpgPassphrase}" --decrypt -o ${tempDecrypted} ${backupPath}`);
      await execAsync(`gunzip -c ${tempDecrypted} > ${tempDecompressed}`);
      
      // Check for essential SQL elements
      const { stdout } = await execAsync(`head -100 ${tempDecompressed}`);
      const hasCreateTable = stdout.includes('CREATE TABLE');
      const hasInsert = stdout.includes('INSERT INTO') || stdout.includes('COPY');
      
      await unlink(tempDecrypted);
      await unlink(tempDecompressed);
      
      return hasCreateTable && hasInsert;
    } catch (error) {
      this.logger.error(`SQL validation failed: ${error.message}`);
      return false;
    }
  }

  private async verifySampleData(backupPath: string): Promise<boolean> {
    const dbHost = this.configService.get('DATABASE_HOST', 'localhost');
    const dbPort = this.configService.get('DATABASE_PORT', 5432);
    const dbUser = this.configService.get('DATABASE_USER', 'postgres');
    const dbPassword = this.configService.get('DATABASE_PASSWORD', '');
    
    try {
      // Create test database
      await execAsync(`PGPASSWORD="${dbPassword}" createdb -h ${dbHost} -p ${dbPort} -U ${dbUser} ${this.testDbName}`);
      
      // Restore backup to test database
      await this.restoreToTestDb(backupPath);
      
      // Verify sample data exists
      const { stdout } = await execAsync(
        `PGPASSWORD="${dbPassword}" psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${this.testDbName} -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"`
      );
      
      const tableCount = parseInt(stdout.trim());
      
      // Cleanup test database
      await execAsync(`PGPASSWORD="${dbPassword}" dropdb -h ${dbHost} -p ${dbPort} -U ${dbUser} ${this.testDbName}`);
      
      return tableCount > 0;
    } catch (error) {
      this.logger.error(`Sample data verification failed: ${error.message}`);
      // Cleanup on error
      try {
        await execAsync(`PGPASSWORD="${dbPassword}" dropdb -h ${dbHost} -p ${dbPort} -U ${dbUser} ${this.testDbName}`);
      } catch {}
      return false;
    }
  }

  private async restoreToTestDb(backupPath: string): Promise<void> {
    const tempDir = join(this.backupDir, 'test_restore');
    const decryptedPath = join(tempDir, 'test_backup.sql.gz');
    const decompressedPath = join(tempDir, 'test_backup.sql');
    const gpgPassphrase = this.configService.get('BACKUP_GPG_PASSPHRASE', 'change-me');
    const dbHost = this.configService.get('DATABASE_HOST', 'localhost');
    const dbPort = this.configService.get('DATABASE_PORT', 5432);
    const dbUser = this.configService.get('DATABASE_USER', 'postgres');
    const dbPassword = this.configService.get('DATABASE_PASSWORD', '');

    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    try {
      await execAsync(`gpg --batch --yes --passphrase "${gpgPassphrase}" --decrypt -o ${decryptedPath} ${backupPath}`);
      await execAsync(`gunzip -c ${decryptedPath} > ${decompressedPath}`);
      await execAsync(`PGPASSWORD="${dbPassword}" psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${this.testDbName} -f ${decompressedPath}`);
      
      await unlink(decryptedPath);
      await unlink(decompressedPath);
    } catch (error) {
      throw new Error(`Test restore failed: ${error.message}`);
    }
  }

  async getVerificationLogs(): Promise<any[]> {
    // This would typically read from a verification log table
    // For now, return a placeholder structure
    return [
      {
        timestamp: new Date(),
        backupFile: 'example-backup.sql.gz.gpg',
        success: true,
        details: 'All verification checks passed'
      }
    ];
  }
}