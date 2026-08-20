import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  namespace: '/noc',
  path: '/noc-socket',
  cors: { origin: '*', credentials: true },
})
export class NocGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NocGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    this.logger.log(`NOC client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`NOC client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:device')
  handleSubscribeDevice(client: Socket, deviceId: string) {
    client.join(`device:${deviceId}`);
  }

  @SubscribeMessage('unsubscribe:device')
  handleUnsubscribeDevice(client: Socket, deviceId: string) {
    client.leave(`device:${deviceId}`);
  }

  broadcastDeviceStatus(deviceId: string, data: { status: string; updatedAt: Date }) {
    this.server.to(`device:${deviceId}`).emit('device:status', { deviceId, ...data });
    this.server.emit('device:status', { deviceId, ...data });
  }

  broadcastDashboardUpdate(data: any) {
    this.server.emit('dashboard:update', data);
  }
}
