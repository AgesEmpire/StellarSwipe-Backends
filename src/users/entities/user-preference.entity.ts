import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToOne,
    JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum RiskLevel {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
}

@Entity('user_preferences')
export class UserPreference {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column()
    userId!: string;

    @OneToOne(() => User, (user) => user.preference, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user!: User;

    @Column({ default: true })
    emailNotifications!: boolean;

    @Column({ default: true })
    pushNotifications!: boolean;

    @Column({ default: true })
    tradeNotifications!: boolean;

    @Column({
        type: 'enum',
        enum: RiskLevel,
        default: RiskLevel.MEDIUM,
    })
    riskLevel!: RiskLevel;

    @Column({ default: 'en', length: 10 })
    language!: string;

    @Column({ default: 'USD', length: 10 })
    preferredCurrency!: string;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 1.0 })
    defaultSlippagePercent!: number;

    @CreateDateColumn()
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;
}
