import { Injectable, Logger } from '@nestjs/common';
import { MetadataSchema } from '../interfaces/metadata-schema.interface';

@Injectable()
export class IpfsUploader {
  private readonly logger = new Logger(IpfsUploader.name);

  async uploadMetadata(metadata: MetadataSchema): Promise<{ hash: string; uri: string }> {
    // In production, integrate with Pinata, NFT.Storage, or Web3.Storage
    // For now, returns a deterministic mock CID based on content hash
    const content = JSON.stringify(metadata);
    const mockHash = Buffer.from(content).toString('base64').slice(0, 46);
    const hash = `Qm${mockHash}`;
    const uri = `ipfs://${hash}`;
    this.logger.debug(`Metadata pinned: ${uri}`);
    return { hash, uri };
  }

  async uploadImage(imageBuffer: Buffer, filename: string): Promise<{ hash: string; uri: string }> {
    const mockHash = `Qm${Buffer.from(filename).toString('base64').slice(0, 46)}`;
    return { hash: mockHash, uri: `ipfs://${mockHash}` };
  }
}
