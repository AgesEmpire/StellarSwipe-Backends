import { PartialType } from '@nestjs/swagger';
import { CreateKycDto } from './create-kyc.dto';

export class UpdateKycDto extends PartialType(CreateKycDto) {}
