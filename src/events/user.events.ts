import { BaseEvent, EventMetadata } from './base.event';
import { IsNotEmpty, IsString, IsEmail, IsOptional, validateSync } from 'class-validator';

/**
 * Emitted when a new user registers
 */
export class UserRegisteredEvent extends BaseEvent {
  readonly eventName = 'user.registered';

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsEmail()
  readonly email: string;

  @IsNotEmpty()
  @IsString()
  readonly username: string;

  @IsOptional()
  @IsString()
  readonly referralCode?: string;

  @IsOptional()
  readonly metadata?: EventMetadata;

  constructor(data: {
    userId: string;
    email: string;
    username: string;
    referralCode?: string;
    metadata?: EventMetadata;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`User registered event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}

/**
 * Emitted when user profile is updated
 */
export class UserProfileUpdatedEvent extends BaseEvent {
  readonly eventName = 'user.profile.updated';

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsOptional()
  readonly changes?: Record<string, any>;

  constructor(data: {
    userId: string;
    changes?: Record<string, any>;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`User profile updated event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}

/**
 * Emitted when a user follows a signal provider
 */
export class UserFollowedProviderEvent extends BaseEvent {
  readonly eventName = 'user.followed.provider';

  @IsNotEmpty()
  @IsString()
  readonly userId: string;

  @IsNotEmpty()
  @IsString()
  readonly providerId: string;

  constructor(data: {
    userId: string;
    providerId: string;
    correlationId?: string;
  }) {
    super(data.correlationId);
    Object.assign(this, data);
    this.validate();
  }

  validate(): void {
    const errors = validateSync(this);
    if (errors.length > 0) {
      throw new Error(`User followed provider event validation failed: ${JSON.stringify(errors)}`);
    }
  }
}