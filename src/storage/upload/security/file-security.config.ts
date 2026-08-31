/**
 * Central configuration for upload security constraints.
 * Keep this list conservative — extend deliberately, not by request payload.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/json',
] as const;

export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Only allow a safe, predictable filename shape: name.ext, no path traversal, no control chars. */
export const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.[a-zA-Z0-9]{1,10}$/;

/** Filenames/extensions that must never be persisted regardless of declared MIME type. */
export const DISALLOWED_EXTENSIONS = [
  '.exe', '.dll', '.sh', '.bat', '.cmd', '.ps1', '.js', '.php', '.jar', '.msi', '.com', '.scr',
];
