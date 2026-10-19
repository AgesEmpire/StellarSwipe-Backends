import { Controller, Get, Req, Res, Post, Body, UseGuards, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TwitterOauthService } from './twitter-oauth.service';
import { OAuthStateService } from './oauth-state.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

@ApiTags('Social Auth')
@Controller('auth/social')
export class SocialAuthController {
    constructor(
        private readonly twitterService: TwitterOauthService,
        private readonly jwtService: JwtService,
        private readonly oauthStateService: OAuthStateService,
    ) { }

    @Get('twitter')
    // @UseGuards(AuthGuard('twitter')) // In production, we'd use the passport strategy
    @ApiOperation({ summary: 'Initiate Twitter OAuth flow (Mocked for now)' })
    async twitterLogin(@Res() res: any) {
        // Generate an atomic, short-lived OAuth state value
        const state = await this.oauthStateService.generateState({
            provider: 'twitter',
            redirectUri: '/auth/social/twitter/callback',
        });

        // In production, passport handles redirect to Twitter with state parameter
        res.redirect(`/auth/social/twitter/callback?mock=true&state=${state}`);
    }

    @Get('twitter/callback')
    @ApiOperation({ summary: 'Twitter OAuth callback with atomic state validation' })
    @ApiQuery({ name: 'state', required: false, description: 'Single-use OAuth state parameter' })
    async twitterCallback(
        @Req() req: any,
        @Res() res: any,
        @Query('state') state?: string,
    ) {
        // When state is provided, atomically consume it (rejecting replays, expired, or concurrent attempts)
        if (state) {
            await this.oauthStateService.consumeState({
                state,
                provider: 'twitter',
            });
        }

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
