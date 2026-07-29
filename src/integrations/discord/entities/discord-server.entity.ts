import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('discord_servers')
export class DiscordServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  guildId: string;

  @Column()
  guildName: string;

  @Column({ nullable: true })
  alertChannelId: string;

  @Column({ nullable: true })
  announcementChannelId: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
