import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { NftCollection } from './nft-collection.entity';
import { NftType, NftRarity } from '../interfaces/metadata-schema.interface';

@Entity('minted_nfts')
export class MintedNft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  tokenId: string;

  @Column('uuid')
  @Index()
  collectionId: string;

  @ManyToOne(() => NftCollection, (c) => c.nfts)
  @JoinColumn({ name: 'collectionId' })
  collection: NftCollection;

  @Column('uuid')
  @Index()
  ownerId: string;

  @Column({ length: 56 })
  ownerWallet: string;

  @Column({ type: 'varchar' })
  type: NftType;

  @Column({ type: 'varchar', default: 'common' })
  rarity: NftRarity;

  @Column({ nullable: true })
  metadataUri: string;

  @Column({ nullable: true })
  txHash: string;

  @Column({ nullable: true })
  achievementKey: string;

  @CreateDateColumn()
  mintedAt: Date;
}
