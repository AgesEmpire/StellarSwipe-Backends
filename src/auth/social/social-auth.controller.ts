import { Controller, Get, Req, Res, Post, Body, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TwitterOauthService } from './twitter-oauth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Social Auth')
@Controller('auth/social')
export class SocialAuthController {
    constructor(
        private readonly twitterService: TwitterOauthService,
        private readonly jwtService: JwtService,
    ) { }

    @Get('twitter')
    // @UseGuards(AuthGuard('twitter')) // In production, we'd use the passport strategy
    @ApiOperation({ summary: 'Initiate Twitter OAuth flow (Mocked for now)' })
    async twitterLogin(@Res() res: any) {
        // In production, passport handles redirect to Twitter
        res.redirect('/auth/social/twitter/callback?mock=true');
    }

    @Get('twitter/callback')
    @ApiOperation({ summary: 'Twitter OAuth callback' })
    async twitterCallback(@Req() req: any, @Res() res: any) {
        // Mock profile for demonstration if requested
        const mockProfile = req.query.mock === 'true' ? {
            id: 'mock_twitter_id',
            username: 'stellarswipe_user',
            displayName: 'Stellar Swiper',
            photos: [{ value: 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png' }],
            _json: { followers_count: 150 }
        } : req.user;

        const user = await this.twitterService.handleTwitterLogin(mockProfile, 'mock_access_token', 'mock_refresh_token');

        const payload = { sub: user.id };
        const accessToken = this.jwtService.sign(payload);

        // In a real app, you'd redirect to frontend with the token
        res.json({ accessToken, user });
    }

    @Post('link-wallet')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Link a wallet to the social account' })
    async linkWallet(@Req() req: any, @Body() dto: { publicKey: string; signature: string; message: string }) {
        // Validation logic would call AuthService
        return {
            success: true,
            userId: req.user.userId,
            linkedWallet: dto.publicKey
        };
    }
}
