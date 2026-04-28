import { Module, Global } from '@nestjs/common';
import { DarkLaunchService } from './dark-launch.service';
import { DarkLaunchGuard } from './dark-launch.guard';

@Global()
@Module({
  providers: [DarkLaunchService, DarkLaunchGuard],
  exports: [DarkLaunchService, DarkLaunchGuard],
})
export class FeaturesModule {}
