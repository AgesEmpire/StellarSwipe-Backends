
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthChallengeDto } from './dto/auth-challenge.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { RegisterDto } from './dto/register.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @HttpCode(HttpStatus.CREATED)
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({ status: 201, description: 'User successfully registered' })
    @ApiResponse({ status: 400, description: 'Bad Request' })
    async register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('challenge')
    @HttpCode(HttpStatus.OK)
    async getChallenge(@Body() dto: AuthChallengeDto) {
        if (!dto.publicKey) {
            throw new Error('Public Key is required for now');
        }
        return this.authService.generateChallenge(dto.publicKey);
    }

    @Post('verify')
    @HttpCode(HttpStatus.OK)
    async verify(@Body() dto: VerifySignatureDto) {
        return this.authService.verifySignature(dto);
    }
}
