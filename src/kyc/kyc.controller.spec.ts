import { Test, TestingModule } from '@nestjs/testing';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';

describe('KycController', () => {
  let controller: KycController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KycController],
      providers: [KycService],
    }).compile();

    controller = module.get<KycController>(KycController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
