import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiValidationService } from "./ai-validation.service";
import { SignalValidationProcessor } from "./processors/signal-validation.processor";
import { Signal } from "../signals/entities/signal.entity";
import { defaultHttpModuleOptions } from "../http/http-client-defaults";

@Module({
  imports: [
    HttpModule.register(defaultHttpModuleOptions()),
    TypeOrmModule.forFeature([Signal]),
  ],
  providers: [AiValidationService, SignalValidationProcessor],
  exports: [AiValidationService],
})
export class AiValidationModule {}
