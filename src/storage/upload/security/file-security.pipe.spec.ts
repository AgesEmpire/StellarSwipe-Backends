import {
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileSecurityPipe } from './file-security.pipe';
import { MalwareScanService } from './malware-scan.service';
import { MAX_UPLOAD_SIZE_BYTES } from './file-security.config';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('safe-content'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
    ...overrides,
  } as Express.Multer.File;
}

describe('FileSecurityPipe', () => {
  const pipe = new FileSecurityPipe(new MalwareScanService());

  it('accepts a valid, clean file', async () => {
    await expect(pipe.transform(makeFile())).resolves.toMatchObject({ originalname: 'photo.png' });
  });

  it('rejects files over the size limit', async () => {
    await expect(
      pipe.transform(makeFile({ size: MAX_UPLOAD_SIZE_BYTES + 1 })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects disallowed MIME types', async () => {
    await expect(
      pipe.transform(makeFile({ mimetype: 'application/x-msdownload' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects disallowed executable extensions', async () => {
    await expect(
      pipe.transform(makeFile({ originalname: 'payload.exe', mimetype: 'image/png' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects unsafe filenames (path traversal)', async () => {
    await expect(
      pipe.transform(makeFile({ originalname: '../../etc/passwd.png' })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects files that fail the malware scan (EICAR signature)', async () => {
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
    await expect(
      pipe.transform(makeFile({ buffer: eicar })),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('fails closed when the scanner throws', async () => {
    const throwingScanner = { scan: jest.fn().mockRejectedValue(new Error('scanner down')) } as any;
    const strictPipe = new FileSecurityPipe(throwingScanner);
    // MalwareScanService itself catches internally; this test documents the
    // fail-closed contract for any alternative MalwareScanner implementation
    // that does not swallow errors — callers relying on the interface must
    // still not persist the file, so this should propagate as a rejection.
    await expect(strictPipe.transform(makeFile())).rejects.toBeTruthy();
  });
});
