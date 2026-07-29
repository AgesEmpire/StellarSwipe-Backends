import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('webauthn_credentials')
export class WebauthnCredential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  /** Base64url-encoded credential ID returned by the authenticator. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 512 })
  credentialId!: string;

  /** Base64url-encoded COSE public key. */
  @Column({ type: 'text' })
  publicKey!: string;

  /** Signature counter used to detect cloned authenticators. */
  @Column({ type: 'bigint', default: 0 })
  counter!: number;

  /** Transports reported at registration time (e.g. usb, ble, nfc, internal). */
  @Column({ type: 'simple-array', nullable: true })
  transports?: string[];

  /** User-friendly label for this passkey (e.g. "MacBook Touch ID"). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  deviceName?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
