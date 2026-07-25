import { WsJwtGuard } from '../../websocket/guards/ws-jwt.guard';

/**
 * Re-export for backward compatibility.
 * @deprecated Use WsJwtGuard directly.
 */
export { WsJwtGuard as WsJwtAuthGuard };
export type { WsAuthenticatedUser } from '../../websocket/guards/ws-jwt.guard';
