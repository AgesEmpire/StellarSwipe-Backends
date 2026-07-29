import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum EncryptedPayloadSourceType {
  WEBHOOK = 'webhook',
  CALLBACK = 'callback',
}

export enum EncryptedPayloadAccessLevel {
  PRIVATE = 'private',
  TENANT = 'tenant',
  ADMIN = 'admin',
}

@Entity('encrypted_payloads')
@Index(['tenantId', 'sourceType', 'createdAt'])
export class EncryptedPayloadRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  tenantId?: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  ownerUserId?: string;

  @Column({ type: 'varchar', length: 32 })
  sourceType!: EncryptedPayloadSourceType;

  @Column({ type: 'varchar', length: 32, default: EncryptedPayloadAccessLevel.PRIVATE })
  accessLevel!: EncryptedPayloadAccessLevel;

  @Column({ type: 'varchar', length: 128 })
  payloadHash!: string;

  @Column({ type: 'text' })
  encryptedPayload!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  payloadSize!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
