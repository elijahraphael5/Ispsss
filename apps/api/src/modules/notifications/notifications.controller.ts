import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'CUSTOMER_SUPPORT', 'BILLING_OFFICER', 'SALES_AGENT', 'FIELD_ENGINEER', 'CUSTOMER')
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'CUSTOMER_SUPPORT')
  create(@Body() body: { title: string; message: string; type?: string; subscriberId?: string; link?: string }) {
    return this.service.create(body);
  }

  @Patch(':id/read')
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'CUSTOMER_SUPPORT', 'BILLING_OFFICER', 'SALES_AGENT', 'FIELD_ENGINEER', 'CUSTOMER')
  markRead(@Param('id') id: string) {
    return this.service.markRead(id);
  }

  @Post('mark-all-read')
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'CUSTOMER_SUPPORT', 'BILLING_OFFICER', 'SALES_AGENT', 'FIELD_ENGINEER', 'CUSTOMER')
  markAllRead() {
    return this.service.markAllRead();
  }
}
