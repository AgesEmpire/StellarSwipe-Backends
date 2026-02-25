import { Injectable } from '@nestjs/common';
import { UserDataExporterService } from '../exporters/user-data-exporter.service';
import * as crypto from 'crypto';

@Injectable()
export class GdprReportGenerator {
  constructor(private userDataExporter: UserDataExporterService) {}

  async generateGdprExport(userId: string): Promise<{ data: any; encrypted: boolean }> {
    const userData = await this.userDataExporter.exportUserData(userId);

    return {
      data: userData,
      encrypted: false,
      gdprCompliant: true,
      dataCategories: ['Personal Information', 'Trading History', 'Signal Submissions', 'Audit Logs'],
      rightsNotice: 'This export includes all personal data as per GDPR Article 15 (Right of Access)',
      exportDate: new Date().toISOString(),
    };
  }

  encryptExport(data: any, password: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return JSON.stringify({
      iv: iv.toString('hex'),
      encryptedData: encrypted,
    });
  }
}
