import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { MintedNft } from './minted-nft.entity';

@Entity('nft_collections')
export class NftCollection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  symbol: string;

  @Column({ nullable: true })
  contractId: string;

  @Column('text', { nullable: true })
  description: string;

  @Column({ default: 0 })
  totalMinted: number;

  @Column({ nullable: true })
  maxSupply: number;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => MintedNft, (nft) => nft.collection)
  nfts: MintedNft[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
