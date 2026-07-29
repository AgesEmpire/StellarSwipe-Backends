import { Stream } from 'stream';

export interface UploadedFileMetadata {
  /** Original file name from the client. */
  originalName: string;
  /** MIME type of the file. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** Extension extracted from the original name. */
  extension: string;
  /** Storage path or key (e.g., S3 key or disk path). */
  storagePath: string;
  /** SHA-256 hash of the file content for deduplication. */
  contentHash: string;
  /** When the file was uploaded. */
  uploadedAt: Date;
}

export interface FileUploadOptions {
  /** Maximum file size in bytes (default: 5MB). */
  maxSize?: number;
  /** Allowed MIME types (default: common image and document types). */
  allowedMimeTypes?: string[];
  /** Whether to scan the file name for path traversal characters. */
  sanitizeFileName?: boolean;
  /** Whether to compute the content hash. */
  computeHash?: boolean;
}

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

export const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/json',
  'text/csv',
];

export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
