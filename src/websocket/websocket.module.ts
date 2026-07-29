import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebsocketGateway } from './websocket.gateway';
import { SocketManagerService } from './services/socket-manager.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
      }),
    }),
  ],
  providers: [WebsocketGateway, SocketManagerService, WsJwtGuard],
  exports: [SocketManagerService, WebsocketGateway],
})
export class WebsocketModule {}
