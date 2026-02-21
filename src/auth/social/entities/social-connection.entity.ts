import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from '../../../users/entities/user.entity';

export enum SocialProvider {
    TWITTER = 'twitter',
    GOOGLE = 'google', // For future expansion
}

@Entity('social_connections')
@Index(['provider', 'providerId'], { unique: true })
export class SocialConnection {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user!: User;

    @Column({
        type: 'enum',
        enum: SocialProvider,
    })
    provider!: SocialProvider;

    @Column({ name: 'provider_id' })
    providerId!: string;

    @Column({ name: 'username', nullable: true })
    username?: string;

    @Column({ name: 'display_name', nullable: true })
    displayName?: string;

    @Column({ name: 'profile_image_url', nullable: true })
    profileImageUrl?: string;

    @Column({ type: 'jsonb', nullable: true })
    profileData?: Record<string, any>;

    @Column({ name: 'access_token', nullable: true })
    accessToken?: string;

    @Column({ name: 'refresh_token', nullable: true })
    refreshToken?: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt!: Date;
}
