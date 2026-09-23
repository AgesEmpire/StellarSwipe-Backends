export interface SignedUrlOptions {
  expiresInSeconds?: number;
  contentType?: string;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

/**
 * Portable storage abstraction so upload/signed-url/cleanup logic is not
 * coupled to a specific backend (local disk, S3, GCS, test doubles, etc).
 */
export interface StorageProvider {
  upload(key: string, data: Buffer | NodeJS.ReadableStream, contentType?: string): Promise<UploadResult>;
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
