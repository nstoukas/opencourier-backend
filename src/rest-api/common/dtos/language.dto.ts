import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'
import { RefuseIfNotSentAsString } from 'src/decorators/refuseIfNotSentAsString.decorator'
import { LANGUAGES, Language } from 'src/localization/translate'

// Spec 0054 (AC-1, AC-2): the language a person reads the apps in. One body for the three apps' routes
// (`PUT courier/v1/courier/language`, `PUT partner/v1/auth/language`, `PUT admin/v1/auth/language`).
export class LanguageInput {
  @ApiProperty({ enum: LANGUAGES })
  // A decorator from class-validator: the global ValidationPipe answers 400 for anything but 'el' or 'en'.
  @RefuseIfNotSentAsString()
  @IsIn(LANGUAGES)
  language: Language
}

export class LanguageDto {
  @ApiProperty({ enum: LANGUAGES })
  language: Language

  constructor(language: Language) {
    this.language = language
  }
}
