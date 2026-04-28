export type NftType = 'achievement' | 'trophy' | 'milestone';
export type NftRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface MetadataAttribute {
  trait_type: string;
  value: string | number;
}

export interface MetadataSchema {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  attributes: MetadataAttribute[];
  type: NftType;
  rarity: NftRarity;
  issuer: string;
  issued_at: string;
}
