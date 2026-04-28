
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Keypair } from '@stellar/stellar-sdk';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';

describe('AuthService', () => {
    let service: AuthService;
    let cacheManagerSpec: any;
    let jwtServiceSpec: any;
    let usersServiceSpec: any;
    let emailServiceSpec: any;

    const mockCacheStore = new Map();

    beforeEach(async () => {
        mockCacheStore.clear();

        cacheManagerSpec = {
            set: jest.fn().mockImplementation((key, value) => mockCacheStore.set(key, value)),
            get: jest.fn().mockImplementation((key) => mockCacheStore.get(key)),
            del: jest.fn().mockImplementation((key) => mockCacheStore.delete(key)),
        };

        jwtServiceSpec = {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
        };

        usersServiceSpec = {
            findOrCreateByWalletAddress: jest.fn().mockResolvedValue({ id: 'user-uuid' }),
            findByEmail: jest.fn(),
            createUser: jest.fn().mockResolvedValue({
                id: 'user-uuid',
                email: 'test@example.com',
                username: 'testuser',
                displayName: 'Test User',
            }),
        };

        emailServiceSpec = {
            sendEmail: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AuthService,
                {
                    provide: JwtService,
                    useValue: jwtServiceSpec,
                },
                {
                    provide: CACHE_MANAGER,
                    useValue: cacheManagerSpec,
                },
                {
                    provide: UsersService,
                    useValue: usersServiceSpec,
                },
                {
                    provide: EmailService,
                    useValue: emailServiceSpec,
                },
            ],
        }).compile();

        service = module.get<AuthService>(AuthService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('register', () => {
        it('should successfully register a user', async () => {
            usersServiceSpec.findByEmail.mockRejectedValue(new NotFoundException());
            
            const dto = {
                email: 'test@example.com',
                password: 'password123',
                displayName: 'Test User',
                username: 'testuser',
            };

            const result = await service.register(dto);

            expect(result.user.email).toBe(dto.email);
            expect(result.accessToken).toBe('mock-jwt-token');
            expect(usersServiceSpec.createUser).toHaveBeenCalled();
            expect(emailServiceSpec.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
                to: dto.email,
                subject: 'Welcome to StellarSwipe',
                template: 'welcome',
            }));
        });

        it('should throw if user already exists', async () => {
            usersServiceSpec.findByEmail.mockResolvedValue({ id: 'existing' });

            const dto = {
                email: 'test@example.com',
                password: 'password123',
            };

            await expect(service.register(dto)).rejects.toThrow(UnauthorizedException);
        });
    });

    describe('generateChallenge', () => {
        it('should generate a challenge and store it', async () => {
            const kp = Keypair.random();
            const result = await service.generateChallenge(kp.publicKey());

            expect(result.message).toContain('Sign this message');
            expect(cacheManagerSpec.set).toHaveBeenCalled();
            expect(mockCacheStore.has(`auth_challenge:${kp.publicKey()}`)).toBeTruthy();
        });
    });

    describe('verifySignature', () => {
        it('should verify valid signature and return token', async () => {
            const kp = Keypair.random();
            const { message } = await service.generateChallenge(kp.publicKey());

            const signature = kp.sign(Buffer.from(message)).toString('base64');

            const result = await service.verifySignature({
                publicKey: kp.publicKey(),
                signature,
                message,
            });

            expect(result.accessToken).toBe('mock-jwt-token');
            expect(jwtServiceSpec.sign).toHaveBeenCalledWith({ sub: 'user-uuid' });
            expect(cacheManagerSpec.del).toHaveBeenCalledWith(`auth_challenge:${kp.publicKey()}`);
        });

        it('should fail with invalid signature', async () => {
            const kp = Keypair.random();
            const { message } = await service.generateChallenge(kp.publicKey());

            const otherKp = Keypair.random();
            const signature = otherKp.sign(Buffer.from(message)).toString('base64');

            await expect(service.verifySignature({
                publicKey: kp.publicKey(),
                signature,
                message,
            })).rejects.toThrow(UnauthorizedException);
        });

        it('should fail if challenge not found/expired', async () => {
            const kp = Keypair.random();
            const message = 'Sign this message...';
            const signature = kp.sign(Buffer.from(message)).toString('base64');

            await expect(service.verifySignature({
                publicKey: kp.publicKey(),
                signature,
                message,
            })).rejects.toThrow(UnauthorizedException);
        });

        it('should fail if message mismatch', async () => {
            const kp = Keypair.random();
            const { message } = await service.generateChallenge(kp.publicKey());

            // Sign the real message
            const signature = kp.sign(Buffer.from(message)).toString('base64');

            // Send a different message in verification DTO
            const fakeMessage = 'fake message';

            await expect(service.verifySignature({
                publicKey: kp.publicKey(),
                message: fakeMessage,
                signature,
            })).rejects.toThrow(UnauthorizedException);
        });
    });
});
