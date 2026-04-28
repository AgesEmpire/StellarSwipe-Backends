export interface NftStandard {
  contractId: string;
  tokenId: string;
  owner: string;
  collectionId: string;
  metadataUri: string;
  mintedAt: Date;
  txHash: string;
}

export interface NftTransferResult {
  success: boolean;
  txHash: string;
  from: string;
  to: string;
  tokenId: string;
}
