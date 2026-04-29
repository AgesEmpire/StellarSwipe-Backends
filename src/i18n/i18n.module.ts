import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nModule as NestI18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import * as path from 'path';
import { I18nAppService } from './i18n.service';
import { I18nResponseInterceptor } from './interceptors/i18n-response.interceptor';
import { I18nController } from './i18n.controller';

@Module({
  imports: [
    NestI18nModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        fallbackLanguage: configService.get('app.fallbackLanguage', 'en'),
        loaderOptions: {
          path: path.join(__dirname, '/translations/'),
          watch: true,
        },
        logging: true,
      }),
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        AcceptLanguageResolver,
        new HeaderResolver(['x-custom-lang']),
      ],
      inject: [ConfigService],
    }),
  ],
  controllers: [I18nController],
  providers: [I18nAppService, I18nResponseInterceptor],
  exports: [I18nAppService, I18nResponseInterceptor],
})
export class I18nModule {}
