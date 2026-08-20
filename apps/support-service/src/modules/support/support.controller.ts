import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import {
  SendChatMessageDto,
  ReassignSessionDto,
  PresenceDto,
  ConvertSessionDto,
  CreateTicketDto,
  UpdateTicketDto,
  AddTicketCommentDto,
  CreateCannedDto,
  UpdateCannedDto,
} from './dto/support.dto';

const VIEW_ROLES = ['SUPER_ADMIN', 'SUPPORT_AGENT', 'CUSTOMER_SUPPORT', 'OPERATIONS_MANAGER', 'NOC_ENGINEER'];
const WRITE_ROLES = ['SUPER_ADMIN', 'SUPPORT_AGENT', 'CUSTOMER_SUPPORT'];

@ApiTags('support')
@Controller('support')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...VIEW_ROLES)
export class SupportController {
  constructor(
    private readonly service: SupportService,
    private readonly gateway: SupportGateway,
  ) {}

  @Get('sessions')
  listSessions(@Req() req: any, @Query('scope') scope?: string) {
    return this.service.listSessions(req.user, scope);
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string, @Req() req: any) {
    return this.service.getSession(id, req.user);
  }

  @Post('sessions/:id/pick-up')
  @Roles(...WRITE_ROLES)
  async pickUp(@Param('id') id: string, @Req() req: any) {
    const session = await this.service.pickUp(id, req.user);
    this.gateway.broadcastSessionChanged(session.id);
    this.gateway.broadcastAssigned(session.id, req.user.id);
    return session;
  }

  @Post('sessions/:id/reassign')
  @Roles(...WRITE_ROLES)
  async reassign(@Param('id') id: string, @Body() body: ReassignSessionDto, @Req() req: any) {
    const session = await this.service.reassign(id, body.agentId, req.user);
    this.gateway.broadcastSessionChanged(session.id);
    this.gateway.broadcastAssigned(session.id, body.agentId);
    return session;
  }

  @Post('sessions/:id/read')
  async markRead(@Param('id') id: string, @Req() req: any) {
    const result = await this.service.markSessionRead(id, req.user);
    this.gateway.broadcastRead(id, result.senderType);
    return result;
  }

  @Patch('sessions/:id/close')
  @Roles(...WRITE_ROLES)
  async closeSession(@Param('id') id: string, @Req() req: any) {
    const session = await this.service.closeSession(id, req.user);
    this.gateway.broadcastSessionChanged(session.id);
    return session;
  }

  @Post('sessions/:id/convert-ticket')
  @Roles(...WRITE_ROLES)
  convert(@Param('id') id: string, @Body() body: ConvertSessionDto, @Req() req: any) {
    return this.service.convertSessionToTicket(id, req.user, body);
  }

  @Get('agents')
  listAgents() {
    return this.service.listAgents();
  }

  @Get('customers')
  listCustomers(@Query('search') search?: string) {
    return this.service.listCustomers(search);
  }

  @Patch('presence')
  @Roles(...WRITE_ROLES)
  setPresence(@Req() req: any, @Body() body: PresenceDto) {
    return this.service.setPresence(req.user.id, body.status);
  }

  @Get('canned')
  listCanned() {
    return this.service.listCanned();
  }

  @Post('canned')
  @Roles(...WRITE_ROLES)
  createCanned(@Body() body: CreateCannedDto) {
    return this.service.createCanned(body);
  }

  @Patch('canned/:id')
  @Roles(...WRITE_ROLES)
  updateCanned(@Param('id') id: string, @Body() body: UpdateCannedDto) {
    return this.service.updateCanned(id, body);
  }

  @Delete('canned/:id')
  @Roles(...WRITE_ROLES)
  deleteCanned(@Param('id') id: string) {
    return this.service.deleteCanned(id);
  }

  @Get('tickets')
  listTickets(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listTickets({ status, priority, search });
  }

  @Get('tickets/:id')
  getTicket(@Param('id') id: string, @Req() req: any) {
    return this.service.getTicket(id);
  }

  @Post('tickets')
  @Roles(...WRITE_ROLES)
  createTicket(@Body() body: CreateTicketDto) {
    return this.service.createTicket({
      subscriberId: body.subscriberId!,
      subject: body.subject,
      description: body.description,
      category: body.category,
      priority: body.priority,
      assignedAgentId: body.assignedAgentId,
    });
  }

  @Patch('tickets/:id')
  @Roles(...WRITE_ROLES)
  updateTicket(@Param('id') id: string, @Body() body: UpdateTicketDto, @Req() req: any) {
    return this.service.updateTicket(id, body, req.user);
  }

  @Post('tickets/:id/comments')
  @Roles(...WRITE_ROLES)
  addComment(@Param('id') id: string, @Body() body: AddTicketCommentDto, @Req() req: any) {
    return this.service.addTicketComment(id, body, req.user, 'AGENT');
  }

  @Post('tickets/:id/attachments')
  @Roles(...WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadTicketAttachment(@Param('id') id: string, @Req() req: any, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received (field name: file)');
    return this.service.saveTicketAttachment(id, req.user, file);
  }

  @Get('performance')
  performance(@Query('range') range?: string) {
    return this.service.performance(range ?? 'today');
  }

  @Get('history')
  history(
    @Query('search') search?: string,
    @Query('agentId') agentId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.history({ search, agentId, status, from, to });
  }
}