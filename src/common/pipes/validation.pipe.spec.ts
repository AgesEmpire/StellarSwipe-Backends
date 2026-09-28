import { CustomValidationPipe } from './validation.pipe';
import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsString, IsNumber } from 'class-validator';

class TestDto {
  @IsString()
  name: string;

  @IsNumber()
  age: number;
}

describe('CustomValidationPipe', () => {
  let target: CustomValidationPipe;

  beforeEach(() => {
    target = new CustomValidationPipe();
  });

  it('should pass valid data', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: TestDto, data: '' };
    const result = await target.transform({ name: 'Test', age: 30 }, metadata);
    expect(result.name).toEqual('Test');
    expect(result.age).toEqual(30);
  });

  it('should throw BadRequestException on invalid data', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: TestDto, data: '' };
    await expect(target.transform({ name: 123, age: 'invalid' }, metadata)).rejects.toThrow(BadRequestException);
  });
});
