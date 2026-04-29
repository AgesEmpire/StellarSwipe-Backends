import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { I18nAppService } from './i18n.service';
import { Language } from './decorators/language.decorator';

@ApiTags('i18n')
@Controller('i18n')
export class I18nController {
  constructor(private readonly i18nService: I18nAppService) {}

  @Get('languages')
  @ApiOperation({ summary: 'Get list of supported languages' })
  getSupportedLanguages(): { languages: string[] } {
    return {
      languages: this.i18nService.getSupportedLanguages(),
    };
  }

  @Get('translate')
  @ApiOperation({ summary: 'Translate a message key' })
  @ApiQuery({ name: 'key', required: true, description: 'Translation key' })
  @ApiQuery({ name: 'lang', required: false, description: 'Language code' })
  async translate(
    @Query('key') key: string,
    @Language() lang: string,
  ): Promise<{ key: string; translation: string; language: string }> {
    const translation = await this.i18nService.translate(key, lang);
    return {
      key,
      translation,
      language: lang,
    };
  }
}
