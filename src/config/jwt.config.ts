import { registerAs } from '@nestjs/config';
import { JwtConfig } from './schemas/config.interface';

export const jwtConfig = registerAs(
  'jwt',
  (): JwtConfig => ({
    secret: process.env.JWT_SECRET || 'change-this-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  }),
);
