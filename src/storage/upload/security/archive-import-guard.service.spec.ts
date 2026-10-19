import {
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { ArchiveImportGuardService } from './archive-import-guard.service';
import { FileUploadService } from '../file-upload.service';
import { ConfigService } from '@nestjs/config';

/**
 * Helper to construct a standard PKZIP buffer containing the given entries.
 * Supports method 8 (deflate) and method 0 (stored), plus optional header overrides
 * to simulate tampered/malformed archives.
 */
function buildZipFixture(
  entries: Array<{
    name: string;
    content: Buffer;
    method?: 0 | 8;
    overrideCompressedSize?: number;
    overrideUncompressedSize?: number;
    flags?: number;
  }>,
): Buffer {
  const localHeadersAndData: Buffer[] = [];
  const centralDirHeaders: Buffer[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressedData =
      method === 8 ? zlib.deflateRawSync(entry.content) : Buffer.from(entry.content);

    const compressedSize = entry.overrideCompressedSize ?? compressedData.length;
    const uncompressedSize = entry.overrideUncompressedSize ?? entry.content.length;
    const flags = entry.flags ?? 0;

    // Local File Header (30 bytes + name)
    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(flags, 6); // general purpose bit flag
    lfh.writeUInt16LE(method, 8); // compression method
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0, 12); // mod date
    lfh.writeUInt32LE(0, 14); // crc32 (0 for test fixture)
    lfh.writeUInt32LE(compressedSize, 18); // compressed size
    lfh.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // file name length
    lfh.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(lfh, 30);

    localHeadersAndData.push(lfh, compressedData);

    // Central Directory File Header (46 bytes + name)
    const cdfh = Buffer.alloc(46 + nameBuf.length);
    cdfh.writeUInt32LE(0x02014b50, 0); // signature
    cdfh.writeUInt16LE(20, 4); // version made by
    cdfh.writeUInt16LE(20, 6); // version needed
    cdfh.writeUInt16LE(flags, 8);
    cdfh.writeUInt16LE(method, 10);
    cdfh.writeUInt16LE(0, 12);
    cdfh.writeUInt16LE(0, 14);
    cdfh.writeUInt32LE(0, 16); // crc32
    cdfh.writeUInt32LE(compressedSize, 20);
    cdfh.writeUInt32LE(uncompressedSize, 24);
    cdfh.writeUInt16LE(nameBuf.length, 28);
    cdfh.writeUInt16LE(0, 30); // extra length
    cdfh.writeUInt16LE(0, 32); // comment length
    cdfh.writeUInt16LE(0, 34); // disk number
    cdfh.writeUInt16LE(0, 36); // internal attrs
    cdfh.writeUInt32LE(0, 38); // external attrs
    cdfh.writeUInt32LE(currentOffset, 42); // relative offset of local header
    nameBuf.copy(cdfh, 46);

    centralDirHeaders.push(cdfh);
    currentOffset += lfh.length + compressedData.length;
  }

  const centralDirBuffer = Buffer.concat(centralDirHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirBuffer.length, 12); // size of central dir
  eocd.writeUInt32LE(currentOffset, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeadersAndData, centralDirBuffer, eocd]);
}

describe('ArchiveImportGuardService', () => {
  let guard: ArchiveImportGuardService;
  let tempDir: string;

  beforeEach(() => {
    guard = new ArchiveImportGuardService();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-guard-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('valid archive fixtures', () => {
    it('accepts and extracts a valid multi-file ZIP archive within bounds', async () => {
      const csvContent = Buffer.from('id,symbol,amount\n1,XLM,100.50\n2,USDC,250.00\n');
      const jsonContent = Buffer.from(JSON.stringify({ version: 1, source: 'stellar' }));

      const validZip = buildZipFixture([
        { name: 'trades.csv', content: csvContent, method: 8 },
        { name: 'metadata.json', content: jsonContent, method: 0 },
      ]);

      const result = await guard.inspectAndExtract({ buffer: validZip });

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].name).toBe('trades.csv');
      expect(result.entries[0].data.toString('utf8')).toBe(csvContent.toString('utf8'));
      expect(result.entries[1].name).toBe('metadata.json');
      expect(result.entries[1].data.toString('utf8')).toBe(jsonContent.toString('utf8'));
      expect(result.totalExpandedBytes).toBe(csvContent.length + jsonContent.length);
    });

    it('accepts and extracts a valid GZIP archive within bounds', async () => {
      const original = Buffer.from('account,balance\nGABC123,500\nGDEF456,1200\n');
      const gzipped = zlib.gzipSync(original);

      const result = await guard.inspectAndExtract({
        buffer: gzipped,
        originalName: 'balances.csv.gz',
      });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].name).toBe('balances.csv');
      expect(result.entries[0].data.equals(original)).toBe(true);
    });
  });

  describe('oversized and high-expansion-ratio bomb fixtures', () => {
    it('blocks a classic ZIP decompression bomb exceeding expansion ratio', async () => {
      // Highly repetitive 2 MB zero-filled payload compresses to ~2 KB (~1000x ratio)
      const bombPayload = Buffer.alloc(2 * 1024 * 1024, 'A');
      const zipBomb = buildZipFixture([
        { name: 'bomb.csv', content: bombPayload, method: 8 },
      ]);

      const tempFile = path.join(tempDir, 'zip-bomb.zip');
      fs.writeFileSync(tempFile, zipBomb);

      await expect(
        guard.inspectAndExtract(
          { tempFilePath: tempFile },
          { maxExpansionRatio: 20 },
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      // Verify rejected archive was cleaned up from disk
      expect(fs.existsSync(tempFile)).toBe(false);
    });

    it('blocks a GZIP decompression bomb exceeding expansion ratio and cleans up temp file', async () => {
      const bombPayload = Buffer.alloc(1024 * 1024, 0); // 1 MB of zeros -> ~1 KB gzipped
      const gzipBomb = zlib.gzipSync(bombPayload);
      const tempFile = path.join(tempDir, 'bomb.csv.gz');
      fs.writeFileSync(tempFile, gzipBomb);

      await expect(
        guard.inspectAndExtract(
          { tempFilePath: tempFile, originalName: 'bomb.csv.gz' },
          { maxExpansionRatio: 15 },
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(fs.existsSync(tempFile)).toBe(false);
    });

    it('blocks an archive with spoofed small header size that expands beyond single-entry limit', async () => {
      // Header claims 100 bytes uncompressed, but deflate stream actually expands to 50 KB
      const actualPayload = Buffer.from(
        Array.from({ length: 12500 }, (_, i) => `row_${i}`).join(','),
      );
      const spoofedZip = buildZipFixture([
        {
          name: 'spoofed.csv',
          content: actualPayload,
          method: 8,
          overrideUncompressedSize: 100,
        },
      ]);

      await expect(
        guard.inspectAndExtract(
          { buffer: spoofedZip },
          { maxSingleEntrySizeBytes: 4096, maxExpansionRatio: 1000 },
        ),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('blocks an archive exceeding total expanded size across multiple entries', async () => {
      // High-entropy buffers so compression ratio stays ~1x, isolating totalExpandedSizeBytes check
      const chunk1 = Buffer.alloc(4000);
      const chunk2 = Buffer.alloc(4000);
      for (let i = 0; i < 4000; i++) {
        chunk1[i] = (i * 73 + 19) & 0xff;
        chunk2[i] = (i * 131 + 47) & 0xff;
      }

      const multiZip = buildZipFixture([
        { name: 'part1.csv', content: chunk1, method: 0 },
        { name: 'part2.csv', content: chunk2, method: 0 },
      ]);

      await expect(
        guard.inspectAndExtract(
          { buffer: multiZip },
          {
            maxSingleEntrySizeBytes: 5000,
            maxExpandedSizeBytes: 6000,
            maxExpansionRatio: 50,
          },
        ),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('blocks an archive exceeding maximum compressed size before extraction', async () => {
      const data = Buffer.alloc(2048, 'x');
      const zip = buildZipFixture([{ name: 'data.txt', content: data, method: 0 }]);
      const tempFile = path.join(tempDir, 'oversized-compressed.zip');
      fs.writeFileSync(tempFile, zip);

      await expect(
        guard.inspectAndExtract(
          { tempFilePath: tempFile },
          { maxCompressedSizeBytes: 512 },
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(fs.existsSync(tempFile)).toBe(false);
    });

    it('blocks an archive exceeding maximum entry count (million-tiny-files bomb)', async () => {
      const entries = Array.from({ length: 12 }, (_, idx) => ({
        name: `item_${idx}.txt`,
        content: Buffer.from(`val_${idx}`),
        method: 0 as const,
      }));
      const manyEntriesZip = buildZipFixture(entries);

      await expect(
        guard.inspectAndExtract({ buffer: manyEntriesZip }, { maxEntryCount: 5 }),
      ).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('nested archive fixtures', () => {
    it('rejects a ZIP containing a nested ZIP archive (42.zip style recursive bomb)', async () => {
      const innerZip = buildZipFixture([
        { name: 'inner.csv', content: Buffer.from('a,b,c\n1,2,3'), method: 8 },
      ]);
      const outerZip = buildZipFixture([
        { name: 'layer1.zip', content: innerZip, method: 0 },
      ]);

      const tempFile = path.join(tempDir, 'nested.zip');
      fs.writeFileSync(tempFile, outerZip);

      await expect(
        guard.inspectAndExtract({ tempFilePath: tempFile }),
      ).rejects.toThrow(BadRequestException);

      expect(fs.existsSync(tempFile)).toBe(false);
    });

    it('rejects a disguised nested archive even if renamed to .csv', async () => {
      const innerZip = buildZipFixture([
        { name: 'secret.txt', content: Buffer.from('hidden'), method: 8 },
      ]);
      const disguisedOuterZip = buildZipFixture([
        { name: 'disguised.csv', content: innerZip, method: 0 },
      ]);

      await expect(
        guard.inspectAndExtract({ buffer: disguisedOuterZip }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a GZIP wrapping another GZIP stream', async () => {
      const innerGz = zlib.gzipSync(Buffer.from('nested-payload'));
      const outerGz = zlib.gzipSync(innerGz);

      await expect(
        guard.inspectAndExtract({
          buffer: outerGz,
          originalName: 'double.txt.gz',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('malformed and unsafe archive fixtures', () => {
    it('rejects truncated/corrupted ZIP headers and cleans up staging paths', async () => {
      const corruptedZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0xff]);
      const stagingDir = path.join(tempDir, 'staging-work');
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(path.join(stagingDir, 'partial.tmp'), 'partial');

      await expect(
        guard.inspectAndExtract(
          { buffer: corruptedZip },
          undefined,
          [stagingDir],
        ),
      ).rejects.toThrow(BadRequestException);

      expect(fs.existsSync(stagingDir)).toBe(false);
    });

    it('rejects ZIP entries with corrupted deflate streams', async () => {
      const validZip = buildZipFixture([
        { name: 'broken.csv', content: Buffer.from('some valid text to compress'), method: 8 },
      ]);
      // Corrupt the compressed payload bytes right after the 30+10 byte local header
      validZip[40] ^= 0xff;
      validZip[41] ^= 0xff;
      validZip[42] ^= 0xff;

      await expect(
        guard.inspectAndExtract({ buffer: validZip }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects ZIP entries attempting Zip-Slip path traversal', async () => {
      const traversalZip = buildZipFixture([
        { name: '../../etc/passwd', content: Buffer.from('root:x:0:0'), method: 0 },
      ]);

      await expect(
        guard.inspectAndExtract({ buffer: traversalZip }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-archive random binary bytes', async () => {
      const randomBytes = Buffer.from('not-an-archive-at-all');
      await expect(
        guard.inspectAndExtract({ buffer: randomBytes }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('FileUploadService.importArchive integration', () => {
    let uploadService: FileUploadService;
    let uploadDir: string;

    beforeEach(() => {
      uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-archive-int-'));
      const configService = new ConfigService({ UPLOAD_DIR: uploadDir });
      uploadService = new FileUploadService(configService, guard);
    });

    afterEach(() => {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    });

    it('imports and persists entries from a valid archive and removes temp archive file', async () => {
      const zip = buildZipFixture([
        { name: 'import1.csv', content: Buffer.from('col1,col2\nval1,val2'), method: 8 },
        { name: 'notes.txt', content: Buffer.from('hello world'), method: 0 },
      ]);
      const tempArchivePath = path.join(tempDir, 'valid-import.zip');
      fs.writeFileSync(tempArchivePath, zip);

      const res = await uploadService.importArchive({
        tempFilePath: tempArchivePath,
        originalname: 'valid-import.zip',
      });

      expect(res.storedFiles).toHaveLength(2);
      expect(fs.existsSync(tempArchivePath)).toBe(false);
      for (const stored of res.storedFiles) {
        expect(fs.existsSync(uploadService.getAbsolutePath(stored.storagePath))).toBe(true);
      }
    });

    it('aborts and rolls back any persisted files if a decompression bomb or disallowed entry is encountered', async () => {
      const bombZip = buildZipFixture([
        { name: 'bomb.csv', content: Buffer.alloc(500 * 1024, 'Z'), method: 8 },
      ]);
      const tempArchivePath = path.join(tempDir, 'rejected-import.zip');
      fs.writeFileSync(tempArchivePath, bombZip);

      await expect(
        uploadService.importArchive(
          { tempFilePath: tempArchivePath, originalname: 'rejected-import.zip' },
          { maxExpansionRatio: 10 },
        ),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(fs.existsSync(tempArchivePath)).toBe(false);
      expect(fs.readdirSync(uploadDir)).toHaveLength(0);
    });
  });
});
