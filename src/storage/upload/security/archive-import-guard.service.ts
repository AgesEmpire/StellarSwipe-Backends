import {
  Injectable,
  Logger,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as zlib from 'zlib';

export interface ArchiveLimits {
  /** Maximum compressed input size in bytes (default: 5 MB) */
  maxCompressedSizeBytes?: number;
  /** Maximum total expanded size across all entries in bytes (default: 25 MB) */
  maxExpandedSizeBytes?: number;
  /** Maximum expanded size for any single entry in bytes (default: 10 MB) */
  maxSingleEntrySizeBytes?: number;
  /** Maximum number of entries allowed in an archive (default: 100) */
  maxEntryCount?: number;
  /** Maximum allowed expansion ratio (uncompressed / compressed, default: 25) */
  maxExpansionRatio?: number;
  /** Maximum allowed archive nesting depth (default: 0 - no nested archives) */
  maxNestingDepth?: number;
}

export interface ArchiveEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

export interface ArchiveExtractionResult {
  entries: ArchiveEntry[];
  totalCompressedBytes: number;
  totalExpandedBytes: number;
  expansionRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: Required<ArchiveLimits> = {
  maxCompressedSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxExpandedSizeBytes: 25 * 1024 * 1024, // 25 MB
  maxSingleEntrySizeBytes: 10 * 1024 * 1024, // 10 MB
  maxEntryCount: 100,
  maxExpansionRatio: 25,
  maxNestingDepth: 0,
};

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const GZIP_MAGIC_BYTE_0 = 0x1f;
const GZIP_MAGIC_BYTE_1 = 0x8b;

const NESTED_ARCHIVE_EXTENSIONS = [
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
];

/**
 * ArchiveImportGuardService
 *
 * Protects archive-based imports from decompression bombs (zip bombs / gzip bombs),
 * excessive entry counts, nested archives, path traversal entries, and oversized
 * extracted payloads before any data is processed or persisted.
 *
 * Ensures rejected archives (including temporary files on disk) are cleaned up
 * immediately and produce a safe client error.
 */
@Injectable()
export class ArchiveImportGuardService {
  private readonly logger = new Logger(ArchiveImportGuardService.name);

  /**
   * Inspects and extracts an archive from a file path or Buffer while enforcing
   * strict bounds on compressed size, expanded size, entry count, expansion ratio,
   * and nesting depth. Cleans up `tempFilePath` (and any staging directories)
   * when an archive is rejected.
   */
  async inspectAndExtract(
    source: { buffer?: Buffer; tempFilePath?: string; originalName?: string },
    customLimits?: ArchiveLimits,
    cleanupPaths: string[] = [],
  ): Promise<ArchiveExtractionResult> {
    const limits: Required<ArchiveLimits> = {
      ...DEFAULT_ARCHIVE_LIMITS,
      ...customLimits,
    };

    const allCleanupTargets = new Set<string>(cleanupPaths);
    if (source.tempFilePath) {
      allCleanupTargets.add(source.tempFilePath);
    }

    try {
      const buffer = await this.loadBoundedCompressedBuffer(source, limits);

      if (buffer.length === 0) {
        throw new BadRequestException('Archive payload is empty');
      }

      if (buffer.length > limits.maxCompressedSizeBytes) {
        throw new PayloadTooLargeException(
          `Compressed archive size (${buffer.length} bytes) exceeds maximum allowed limit of ${limits.maxCompressedSizeBytes} bytes`,
        );
      }

      if (this.isZipBuffer(buffer)) {
        return this.extractZipBounded(buffer, limits, 0);
      }

      if (this.isGzipBuffer(buffer)) {
        return this.extractGzipBounded(
          buffer,
          source.originalName ?? 'data.gz',
          limits,
          0,
        );
      }

      throw new BadRequestException('Unsupported or malformed archive format');
    } catch (error) {
      await this.cleanupRejectedTargets(Array.from(allCleanupTargets));

      if (
        error instanceof BadRequestException ||
        error instanceof PayloadTooLargeException
      ) {
        throw error;
      }

      this.logger.warn(
        `Archive import rejected due to processing error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException(
        'Malformed or unsafe archive could not be processed',
      );
    }
  }

  public isArchiveBuffer(buffer: Buffer): boolean {
    return this.isZipBuffer(buffer) || this.isGzipBuffer(buffer);
  }

  public isZipBuffer(buffer: Buffer): boolean {
    return (
      buffer.length >= 4 && buffer.readUInt32LE(0) === ZIP_LOCAL_FILE_SIGNATURE
    );
  }

  public isGzipBuffer(buffer: Buffer): boolean {
    return (
      buffer.length >= 2 &&
      buffer[0] === GZIP_MAGIC_BYTE_0 &&
      buffer[1] === GZIP_MAGIC_BYTE_1
    );
  }

  private async loadBoundedCompressedBuffer(
    source: { buffer?: Buffer; tempFilePath?: string },
    limits: Required<ArchiveLimits>,
  ): Promise<Buffer> {
    if (source.buffer) {
      return source.buffer;
    }

    if (source.tempFilePath) {
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(source.tempFilePath);
      } catch {
        throw new BadRequestException('Archive source file could not be read');
      }

      if (stat.size > limits.maxCompressedSizeBytes) {
        throw new PayloadTooLargeException(
          `Compressed archive size (${stat.size} bytes) exceeds maximum allowed limit of ${limits.maxCompressedSizeBytes} bytes`,
        );
      }

      return fs.promises.readFile(source.tempFilePath);
    }

    throw new BadRequestException('No archive content provided');
  }

  private extractZipBounded(
    buffer: Buffer,
    limits: Required<ArchiveLimits>,
    currentDepth: number,
  ): ArchiveExtractionResult {
    const entries: ArchiveEntry[] = [];
    let offset = 0;
    let totalExpandedBytes = 0;
    let sawEndRecord = false;

    while (offset + 4 <= buffer.length) {
      const signature = buffer.readUInt32LE(offset);

      if (
        signature === ZIP_CENTRAL_DIR_SIGNATURE ||
        signature === ZIP_EOCD_SIGNATURE
      ) {
        sawEndRecord = true;
        break;
      }

      if (signature !== ZIP_LOCAL_FILE_SIGNATURE) {
        throw new BadRequestException('Malformed ZIP archive header');
      }

      if (offset + 30 > buffer.length) {
        throw new BadRequestException(
          'Malformed ZIP archive: truncated local file header',
        );
      }

      const generalPurposeFlags = buffer.readUInt16LE(offset + 6);
      // Reject data-descriptor streaming entries where sizes are unknown upfront (bit 3) or encrypted entries (bit 0)
      if ((generalPurposeFlags & 0x0001) !== 0) {
        throw new BadRequestException(
          'Encrypted archive entries are not allowed',
        );
      }

      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const declaredCompressedSize = buffer.readUInt32LE(offset + 18);
      const declaredUncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);

      // 0xFFFFFFFF indicates ZIP64 extended sizes, which are disallowed for bounded imports
      if (
        declaredCompressedSize === 0xffffffff ||
        declaredUncompressedSize === 0xffffffff
      ) {
        throw new PayloadTooLargeException(
          'ZIP64 oversized archive entries are not permitted',
        );
      }

      const headerEnd = offset + 30 + fileNameLength + extraFieldLength;
      if (headerEnd > buffer.length) {
        throw new BadRequestException(
          'Malformed ZIP archive: truncated entry metadata',
        );
      }

      const rawName = buffer
        .subarray(offset + 30, offset + 30 + fileNameLength)
        .toString('utf8');
      this.validateEntryName(rawName);

      const dataEnd = headerEnd + declaredCompressedSize;
      if (dataEnd > buffer.length) {
        throw new BadRequestException(
          'Malformed ZIP archive: truncated compressed data stream',
        );
      }

      // Skip directory-only entries
      if (rawName.endsWith('/') && declaredCompressedSize === 0) {
        offset = dataEnd;
        continue;
      }

      if (entries.length + 1 > limits.maxEntryCount) {
        throw new PayloadTooLargeException(
          `Archive entry count exceeds maximum allowed limit of ${limits.maxEntryCount}`,
        );
      }

      if (declaredUncompressedSize > limits.maxSingleEntrySizeBytes) {
        throw new PayloadTooLargeException(
          `Archive entry "${rawName}" declared size (${declaredUncompressedSize} bytes) exceeds single-file limit of ${limits.maxSingleEntrySizeBytes} bytes`,
        );
      }

      if (
        totalExpandedBytes + declaredUncompressedSize >
        limits.maxExpandedSizeBytes
      ) {
        throw new PayloadTooLargeException(
          `Archive total expanded size exceeds maximum allowed limit of ${limits.maxExpandedSizeBytes} bytes`,
        );
      }

      const compressedSlice = buffer.subarray(headerEnd, dataEnd);
      const remainingTotalBudget =
        limits.maxExpandedSizeBytes - totalExpandedBytes;
      const entryBudget = Math.min(
        limits.maxSingleEntrySizeBytes,
        remainingTotalBudget,
      );

      let expandedData: Buffer;
      if (compressionMethod === 0) {
        // Stored (no compression)
        expandedData = Buffer.from(compressedSlice);
      } else if (compressionMethod === 8) {
        // Deflate
        expandedData = this.inflateRawBounded(
          compressedSlice,
          entryBudget,
          declaredCompressedSize,
          limits.maxExpansionRatio,
        );
      } else {
        throw new BadRequestException(
          `Unsupported ZIP compression method: ${compressionMethod}`,
        );
      }

      // Verify actual expanded size against declared size and budgets
      if (expandedData.length > limits.maxSingleEntrySizeBytes) {
        throw new PayloadTooLargeException(
          `Archive entry "${rawName}" expanded size exceeds maximum single-file limit of ${limits.maxSingleEntrySizeBytes} bytes`,
        );
      }

      totalExpandedBytes += expandedData.length;
      if (totalExpandedBytes > limits.maxExpandedSizeBytes) {
        throw new PayloadTooLargeException(
          `Archive total expanded size (${totalExpandedBytes} bytes) exceeds maximum allowed limit of ${limits.maxExpandedSizeBytes} bytes`,
        );
      }

      const entryRatio =
        declaredCompressedSize > 0
          ? expandedData.length / declaredCompressedSize
          : expandedData.length;
      if (entryRatio > limits.maxExpansionRatio) {
        throw new PayloadTooLargeException(
          `Archive entry "${rawName}" expansion ratio (${entryRatio.toFixed(1)}x) exceeds maximum allowed ratio of ${limits.maxExpansionRatio}x`,
        );
      }

      const overallRatio = totalExpandedBytes / buffer.length;
      if (overallRatio > limits.maxExpansionRatio) {
        throw new PayloadTooLargeException(
          `Archive overall expansion ratio (${overallRatio.toFixed(1)}x) exceeds maximum allowed ratio of ${limits.maxExpansionRatio}x`,
        );
      }

      this.checkNestedArchive(rawName, expandedData, limits, currentDepth);

      entries.push({
        name: rawName,
        compressedSize: declaredCompressedSize,
        uncompressedSize: expandedData.length,
        data: expandedData,
      });

      offset = dataEnd;
    }

    if (!sawEndRecord && entries.length === 0) {
      throw new BadRequestException('Malformed or empty ZIP archive');
    }

    return {
      entries,
      totalCompressedBytes: buffer.length,
      totalExpandedBytes,
      expansionRatio:
        buffer.length > 0 ? totalExpandedBytes / buffer.length : 0,
    };
  }

  private extractGzipBounded(
    buffer: Buffer,
    originalName: string,
    limits: Required<ArchiveLimits>,
    currentDepth: number,
  ): ArchiveExtractionResult {
    if (buffer.length < 18) {
      throw new BadRequestException('Malformed GZIP archive: header too short');
    }

    if (limits.maxEntryCount < 1) {
      throw new PayloadTooLargeException(
        `Archive entry count exceeds maximum allowed limit of ${limits.maxEntryCount}`,
      );
    }

    const entryBudget = Math.min(
      limits.maxSingleEntrySizeBytes,
      limits.maxExpandedSizeBytes,
    );

    let expandedData: Buffer;
    try {
      expandedData = zlib.gunzipSync(buffer, {
        maxOutputLength: entryBudget,
      });
    } catch (err: any) {
      if (
        err?.code === 'ERR_BUFFER_TOO_LARGE' ||
        (err instanceof RangeError &&
          err.message.includes('MaximumBufferLength')) ||
        String(err?.message).includes('maxOutputLength') ||
        String(err?.message).includes('Cannot create a Buffer')
      ) {
        throw new PayloadTooLargeException(
          `Decompressed GZIP payload exceeds maximum allowed size of ${entryBudget} bytes`,
        );
      }
      throw new BadRequestException('Malformed or corrupted GZIP archive');
    }

    const expansionRatio = expandedData.length / buffer.length;
    if (expansionRatio > limits.maxExpansionRatio) {
      throw new PayloadTooLargeException(
        `Archive expansion ratio (${expansionRatio.toFixed(1)}x) exceeds maximum allowed ratio of ${limits.maxExpansionRatio}x`,
      );
    }

    const innerName = originalName.replace(/\.(gz|gzip)$/i, '') || 'extracted';
    this.validateEntryName(innerName);
    this.checkNestedArchive(innerName, expandedData, limits, currentDepth);

    return {
      entries: [
        {
          name: innerName,
          compressedSize: buffer.length,
          uncompressedSize: expandedData.length,
          data: expandedData,
        },
      ],
      totalCompressedBytes: buffer.length,
      totalExpandedBytes: expandedData.length,
      expansionRatio,
    };
  }

  private inflateRawBounded(
    compressedSlice: Buffer,
    maxBytes: number,
    compressedSize: number,
    maxRatio: number,
  ): Buffer {
    const ratioBound = Math.floor(compressedSize * maxRatio);
    const effectiveCap = Math.min(maxBytes, Math.max(ratioBound, 0));

    try {
      return zlib.inflateRawSync(compressedSlice, {
        maxOutputLength: effectiveCap,
      });
    } catch (err: any) {
      if (
        err?.code === 'ERR_BUFFER_TOO_LARGE' ||
        (err instanceof RangeError &&
          err.message.includes('MaximumBufferLength')) ||
        String(err?.message).includes('maxOutputLength') ||
        String(err?.message).includes('Cannot create a Buffer')
      ) {
        if (ratioBound < maxBytes && effectiveCap === ratioBound) {
          throw new PayloadTooLargeException(
            `Archive entry expansion ratio exceeds maximum allowed ratio of ${maxRatio}x`,
          );
        }
        throw new PayloadTooLargeException(
          `Decompressed archive entry exceeds maximum allowed size of ${maxBytes} bytes`,
        );
      }
      throw new BadRequestException(
        'Malformed or corrupted deflate stream in archive',
      );
    }
  }

  private validateEntryName(entryName: string): void {
    if (!entryName || entryName.includes('\0')) {
      throw new BadRequestException(
        'Archive entry contains invalid or null filename',
      );
    }

    const normalized = entryName.replace(/\\/g, '/');
    if (
      normalized.startsWith('/') ||
      normalized.includes('../') ||
      normalized === '..' ||
      /^[a-zA-Z]:/.test(normalized)
    ) {
      throw new BadRequestException(
        `Archive entry "${entryName}" contains disallowed path traversal sequence`,
      );
    }
  }

  private checkNestedArchive(
    entryName: string,
    data: Buffer,
    limits: Required<ArchiveLimits>,
    currentDepth: number,
  ): void {
    const lower = entryName.toLowerCase();
    const hasArchiveExt = NESTED_ARCHIVE_EXTENSIONS.some((ext) =>
      lower.endsWith(ext),
    );
    const hasArchiveMagic = this.isArchiveBuffer(data);

    if (hasArchiveExt || hasArchiveMagic) {
      if (currentDepth + 1 > limits.maxNestingDepth) {
        throw new BadRequestException(
          `Nested archives are not permitted (entry "${entryName}" exceeds max nesting depth of ${limits.maxNestingDepth})`,
        );
      }
    }
  }

  private async cleanupRejectedTargets(paths: string[]): Promise<void> {
    for (const target of paths) {
      if (!target) continue;
      try {
        if (fs.existsSync(target)) {
          await fs.promises.rm(target, { recursive: true, force: true });
        }
      } catch (err) {
        this.logger.warn(
          `Failed to clean up rejected archive artifact at ${target}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
