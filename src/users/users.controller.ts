import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { User } from './entities/user.entity';
import { UserPreference } from './entities/user-preference.entity';

@Controller('users')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    /**
     * Create a new user with wallet address
     * Handles reconnecting users with same wallet by returning existing user
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    async createUser(@Body() createUserDto: CreateUserDto): Promise<User> {
        return this.usersService.createUser(createUserDto);
    }

    /**
     * Get user by wallet address
     */
    @Get('wallet/:walletAddress')
    async findByWalletAddress(
        @Param('walletAddress') walletAddress: string,
    ): Promise<User> {
        return this.usersService.findByWalletAddress(walletAddress);
    }

    /**
     * Find or create user by wallet address
     * Useful for wallet connection flow
     */
    @Post('connect')
    @HttpCode(HttpStatus.OK)
    async connectWallet(
        @Body() createUserDto: CreateUserDto,
    ): Promise<User> {
        return this.usersService.findOrCreateByWalletAddress(
            createUserDto.walletAddress,
        );
    }

    /**
     * Get user preferences
     */
    @Get('wallet/:walletAddress/preferences')
    async getPreferences(
        @Param('walletAddress') walletAddress: string,
    ): Promise<UserPreference> {
        return this.usersService.getPreferences(walletAddress);
    }

    /**
     * Update user preferences
     */
    @Patch('wallet/:walletAddress/preferences')
    async updatePreferences(
        @Param('walletAddress') walletAddress: string,
        @Body() updatePreferenceDto: UpdatePreferenceDto,
    ): Promise<UserPreference> {
        return this.usersService.updatePreferences(walletAddress, updatePreferenceDto);
    }

    /**
     * Soft delete user account
     */
    @Delete('wallet/:walletAddress')
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteUser(
        @Param('walletAddress') walletAddress: string,
    ): Promise<void> {
        return this.usersService.softDelete(walletAddress);
    }
}
