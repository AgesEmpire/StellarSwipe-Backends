import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { MetadataSchema } from '../interfaces/metadata-schema.interface';

@Entity('nft_metadata')
export class NftMetadata {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  tokenId: string;

  @Column('jsonb')
  metadata: MetadataSchema;

  @Column({ nullable: true })
  ipfsHash: string;

  @Column({ nullable: true })
  ipfsUri: string;

  @CreateDateColumn()
  createdAt: Date;
}
