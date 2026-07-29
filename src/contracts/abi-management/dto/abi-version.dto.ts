export class AbiVersionDto {
  contractName!: string;
  network!: string;
  version!: string;
  abiHash!: string;
  createdAt!: string;
  metadata?: Record<string, unknown>;
}
