import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface AtomicExportWriter {
  stagingPath: string;
  finalPath: string;
  publish: () => Promise<string>;
  abort: () => Promise<void>;
}

export interface AtomicWriterOptions {
  exportDir: string;
  fileName: string;
  stagingDirName?: string;
  validator?: (stagingPath: string) => Promise<boolean> | boolean;
}

/**
 * Creates an atomic export writer that writes output to a private staging
 * location and promotes it to the final destination via an atomic rename
 * only after generation and validation succeed.
 */
export async function createAtomicExportWriter(
  options: AtomicWriterOptions,
): Promise<AtomicExportWriter> {
  const {
    exportDir,
    fileName,
    stagingDirName = '.staging',
    validator,
  } = options;

  const stagingDir = path.join(exportDir, stagingDirName);
  await fsp.mkdir(stagingDir, { recursive: true });
  await fsp.mkdir(exportDir, { recursive: true });

  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const stagingFileName = `${fileName}.${randomSuffix}.tmp`;
  const stagingPath = path.join(stagingDir, stagingFileName);
  const finalPath = path.join(exportDir, fileName);

  let finalized = false;

  const publish = async (): Promise<string> => {
    if (!fs.existsSync(stagingPath)) {
      throw new Error(`Cannot publish export: staging file not found at ${stagingPath}`);
    }

    if (validator) {
      const isValid = await validator(stagingPath);
      if (!isValid) {
        await abort();
        throw new Error(`Export validation failed for ${stagingPath}`);
      }
    }

    // Atomic move from staging to final location within the same directory tree
    await fsp.rename(stagingPath, finalPath);
    finalized = true;
    return finalPath;
  };

  const abort = async (): Promise<void> => {
    if (!finalized && fs.existsSync(stagingPath)) {
      try {
        await fsp.unlink(stagingPath);
      } catch {
        // Ignore unlink error if already deleted
      }
    }
  };

  return {
    stagingPath,
    finalPath,
    publish,
    abort,
  };
}

/**
 * Writes data to an export file atomically using a private staging file.
 */
export async function writeExportAtomically(
  exportDir: string,
  fileName: string,
  content: string | Buffer,
  validator?: (stagingPath: string) => Promise<boolean> | boolean,
): Promise<string> {
  const writer = await createAtomicExportWriter({ exportDir, fileName, validator });
  try {
    await fsp.writeFile(writer.stagingPath, content);
    return await writer.publish();
  } catch (err) {
    await writer.abort();
    throw err;
  }
}

/**
 * Validates whether a file identifier points to a finalized, safe export artifact.
 * Rejects path traversal attempts, temporary files, partial files, and hidden files.
 */
export function isSafeExportArtifact(exportDir: string, fileName: string): boolean {
  if (!fileName || typeof fileName !== 'string') return false;

  // Reject path traversal and directory separators
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return false;
  }

  // Reject staging, temporary, partial, and hidden file prefixes/suffixes
  if (
    fileName.startsWith('.') ||
    fileName.endsWith('.tmp') ||
    fileName.endsWith('.part') ||
    fileName.includes('.staging')
  ) {
    return false;
  }

  const resolved = path.resolve(exportDir, fileName);
  const normalizedExportDir = path.resolve(exportDir);

  if (!resolved.startsWith(normalizedExportDir)) {
    return false;
  }

  // Ensure file exists and is not a directory
  if (!fs.existsSync(resolved)) {
    return false;
  }

  try {
    const stat = fs.statSync(resolved);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Purges orphaned/stale staging files left behind by interrupted processes or crashed workers.
 *
 * @param exportDir Base exports directory
 * @param maxAgeMs Maximum age of staging files before cleanup (default: 15 minutes)
 * @returns Number of cleaned files
 */
export async function cleanOrphanedStagingFiles(
  exportDir: string,
  maxAgeMs = 15 * 60 * 1000,
): Promise<number> {
  const stagingDir = path.join(exportDir, '.staging');
  if (!fs.existsSync(stagingDir)) return 0;

  let cleaned = 0;
  const now = Date.now();

  try {
    const entries = await fsp.readdir(stagingDir);
    for (const entry of entries) {
      const entryPath = path.join(stagingDir, entry);
      try {
        const stat = await fsp.stat(entryPath);
        if (stat.isFile() && (now - stat.mtimeMs) >= maxAgeMs) {
          await fsp.unlink(entryPath);
          cleaned++;
        }
      } catch {
        // Entry could be removed concurrently
      }
    }
  } catch {
    // Staging directory inaccessible
  }

  return cleaned;
}
