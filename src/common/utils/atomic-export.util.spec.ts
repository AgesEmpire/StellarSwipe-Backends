import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  createAtomicExportWriter,
  writeExportAtomically,
  isSafeExportArtifact,
  cleanOrphanedStagingFiles,
} from './atomic-export.util';

describe('atomic-export.util', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-export-test-'));
  });

  afterEach(async () => {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('writeExportAtomically', () => {
    it('writes export atomically to destination', async () => {
      const fileName = 'test-export.csv';
      const content = 'col1,col2\nval1,val2';

      const finalPath = await writeExportAtomically(tempDir, fileName, content);
      expect(fs.existsSync(finalPath)).toBe(true);

      const saved = await fsp.readFile(finalPath, 'utf-8');
      expect(saved).toBe(content);

      // Staging directory should not retain temporary file
      const stagingDir = path.join(tempDir, '.staging');
      const stagingFiles = await fsp.readdir(stagingDir);
      expect(stagingFiles.length).toBe(0);
    });

    it('cleans up temporary file and leaves final destination absent on validation failure', async () => {
      const fileName = 'failing-export.csv';
      const content = 'bad-data';

      await expect(
        writeExportAtomically(tempDir, fileName, content, async () => false),
      ).rejects.toThrow('Export validation failed');

      const finalPath = path.join(tempDir, fileName);
      expect(fs.existsSync(finalPath)).toBe(false);

      const stagingDir = path.join(tempDir, '.staging');
      const stagingFiles = await fsp.readdir(stagingDir);
      expect(stagingFiles.length).toBe(0);
    });
  });

  describe('createAtomicExportWriter', () => {
    it('incomplete artifact is invisible in destination until published', async () => {
      const fileName = 'stream-export.csv';
      const writer = await createAtomicExportWriter({
        exportDir: tempDir,
        fileName,
      });

      // Write partial content to staging
      await fsp.writeFile(writer.stagingPath, 'partial-content...');

      // Final artifact cannot be resolved yet
      expect(fs.existsSync(writer.finalPath)).toBe(false);
      expect(isSafeExportArtifact(tempDir, fileName)).toBe(false);

      // Finalize / publish
      await writer.publish();

      // Now it is resolved
      expect(fs.existsSync(writer.finalPath)).toBe(true);
      expect(isSafeExportArtifact(tempDir, fileName)).toBe(true);
    });

    it('cleans up staging file on abort', async () => {
      const fileName = 'aborted-export.csv';
      const writer = await createAtomicExportWriter({
        exportDir: tempDir,
        fileName,
      });

      await fsp.writeFile(writer.stagingPath, 'aborted-data');
      expect(fs.existsSync(writer.stagingPath)).toBe(true);

      await writer.abort();
      expect(fs.existsSync(writer.stagingPath)).toBe(false);
      expect(fs.existsSync(writer.finalPath)).toBe(false);
    });
  });

  describe('isSafeExportArtifact', () => {
    it('returns true for existing completed files', async () => {
      const fileName = 'valid.csv';
      await fsp.writeFile(path.join(tempDir, fileName), 'data');
      expect(isSafeExportArtifact(tempDir, fileName)).toBe(true);
    });

    it('rejects path traversal attempts', () => {
      expect(isSafeExportArtifact(tempDir, '../secret.txt')).toBe(false);
      expect(isSafeExportArtifact(tempDir, 'sub/../../etc/passwd')).toBe(false);
      expect(isSafeExportArtifact(tempDir, '..\\secret.txt')).toBe(false);
    });

    it('rejects temporary and staging files', async () => {
      expect(isSafeExportArtifact(tempDir, 'export.csv.tmp')).toBe(false);
      expect(isSafeExportArtifact(tempDir, 'export.csv.part')).toBe(false);
      expect(isSafeExportArtifact(tempDir, '.staging')).toBe(false);
      expect(isSafeExportArtifact(tempDir, '.hidden')).toBe(false);
    });

    it('rejects non-existent files', () => {
      expect(isSafeExportArtifact(tempDir, 'nonexistent.csv')).toBe(false);
    });
  });

  describe('cleanOrphanedStagingFiles', () => {
    it('cleans files older than maxAgeMs and preserves recent files', async () => {
      const stagingDir = path.join(tempDir, '.staging');
      await fsp.mkdir(stagingDir, { recursive: true });

      const staleFile = path.join(stagingDir, 'stale.tmp');
      const freshFile = path.join(stagingDir, 'fresh.tmp');

      await fsp.writeFile(staleFile, 'stale');
      await fsp.writeFile(freshFile, 'fresh');

      // Set staleFile mtime to 1 hour ago
      const oneHourAgo = new Date(Date.now() - 3600 * 1000);
      await fsp.utimes(staleFile, oneHourAgo, oneHourAgo);

      const cleaned = await cleanOrphanedStagingFiles(tempDir, 1800 * 1000); // 30 min threshold
      expect(cleaned).toBe(1);

      expect(fs.existsSync(staleFile)).toBe(false);
      expect(fs.existsSync(freshFile)).toBe(true);
    });
  });
});
