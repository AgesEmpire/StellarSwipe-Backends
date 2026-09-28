import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DocumentType } from '../entities/legal-document.entity';

@Injectable()
export class DocumentGenerator {
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  generateVersionTag(major: number, minor: number, patch: number): string {
    return `${major}.${minor}.${patch}`;
  }

  incrementVersion(currentVersion: string, changeType: 'major' | 'minor' | 'patch'): string {
    const parts = currentVersion.split('.').map(Number);
    if (parts.length !== 3) return '1.0.0';
    const [major, minor, patch] = parts;
    switch (changeType) {
      case 'major': return `${major + 1}.0.0`;
      case 'minor': return `${major}.${minor + 1}.0`;
      case 'patch': return `${major}.${minor}.${patch + 1}`;
    }
  }

  buildDocumentTitle(type: DocumentType, region: string, language: string): string {
    const typeLabel: Record<DocumentType, string> = {
      [DocumentType.TERMS_OF_SERVICE]: 'Terms of Service',
      [DocumentType.PRIVACY_POLICY]: 'Privacy Policy',
      [DocumentType.DISCLAIMER]: 'Disclaimer',
      [DocumentType.COOKIE_POLICY]: 'Cookie Policy',
      [DocumentType.RISK_DISCLOSURE]: 'Risk Disclosure',
    };
    return `${typeLabel[type]} — ${region.toUpperCase()} (${language.toUpperCase()})`;
  }
}
