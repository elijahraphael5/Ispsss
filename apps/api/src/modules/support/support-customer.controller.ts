import { Controller, Get, Post, Patch, Param, Body, Req, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import { CreateChatSessionDto, SendChatMessageDto, RateSessionDto } from './dto/support.dto';

@ApiTags('chat')
@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class SupportCustomerController {
  constructor(
    private readonly service: SupportService,
    private readonly gateway: SupportGateway,
  ) {}

  @Post('sessions')
  async createSession(@Req() req: any, @Body() body: CreateChatSessionDto) {
    const session = await this.service.createSession({
      userId: req.user.id,
      email: req.user.email,
      department: body.department,
    });
    this.gateway.broadcastNewSession(session);
    return session;
  }

  @Get('sessions')
  listSessions(@Req() req: any) {
    return this.service.getCustomerSessions(req.user.id);
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string, @Req() req: any) {
    return this.service.getSession(id, req.user);
  }

  @Post('sessions/:id/messages')
  async addMessage(@Req() req: any, @Param('id') id: string, @Body() body: SendChatMessageDto) {
    const msg = await this.service.sendMessage({
      sessionId: id,
      actor: req.user,
      senderType: 'CUSTOMER',
      body: body.body,
      attachmentIds: body.attachmentIds,
    });
    this.gateway.broadcastMessage(msg);
    return msg;
  }

  @Patch('sessions/:id/close')
  async closeSession(@Param('id') id: string, @Req() req: any) {
    const session = await this.service.closeSession(id, req.user);
    this.gateway.broadcastSessionChanged(session.id);
    return session;
  }

  @Post('sessions/:id/rating')
  rateSession(@Param('id') id: string, @Req() req: any, @Body() body: RateSessionDto) {
    return this.service.rateSession(id, req.user, body.rating);
  }

  @Post('sessions/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadChatAttachment(@Param('id') id: string, @Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received (field name: file)');
    return this.service.saveChatAttachment(id, req.user, file);
  }

  @Get('attachments/:id')
  async downloadAttachment(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const file = await this.service.getAttachmentFile(id, req.user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    res.sendFile(file.absPath);
  }
}