import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import {
  SignedUrlOptions,
  StorageProvider,
  UploadResult,
} from './storage-provider.interface';

/**
 * Filesystem-backed StorageProvider for local dev and tests. Cloud
 * environments should provide an S3/GCS implementation of the same
 * interface and swap it in via DI (STORAGE_PROVIDER token).
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly rootDir: string;

  constructor(rootDir = join(process.cwd(), '.local-storage')) {
    this.rootDir = rootDir;
  }

  async upload(
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    contentType?: string,
  ): Promise<UploadResult> {
    const targetPath = this.resolvePath(key);
    await fs.mkdir(dirname(targetPath), { recursive: true });

    const buffer = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
    await fs.writeFile(targetPath, buffer);

    this.logger.log(`Uploaded ${key} (${buffer.length} bytes, type=${contentType ?? 'unknown'})`);

    return { key, url: await this.getSignedUrl(key), size: buffer.length };
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    const ttl = options?.expiresInSeconds ?? 900;
    const expiresAt = Date.now() + ttl * 1000;
    return `local://${this.resolvePath(key)}?expires=${expiresAt}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolvePath(key));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  private resolvePath(key: string): string {
    return join(this.rootDir, key);
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
