import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsEmail,
    Length,
    Matches,
} from 'class-validator';

export class CreateUserDto {
    @IsString()
    @IsNotEmpty()
    @Length(3, 50)
    username!: string;

    @IsOptional()
    @IsString()
    @Length(56, 56, { message: 'Wallet address must be exactly 56 characters' })
    @Matches(/^G[A-Z2-7]{55}$/, {
        message: 'Invalid Stellar wallet address format',
    })
    walletAddress?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @Length(1, 100)
    displayName?: string;

    @IsOptional()
    @IsString()
    @Length(1, 500)
    bio?: string;
}
