import { Controller, Get, Post, Patch, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CrmService } from './crm.service';

@ApiTags('crm')
@Controller('crm')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'CEO')
  findAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.findAll({ skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'CEO')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'CUSTOMER_SUPPORT')
  create(@Body() body: { subscriberId: string; documentUrl: string }) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'SALES_AGENT', 'CUSTOMER_SUPPORT')
  update(@Param('id') id: string, @Body() body: { documentUrl?: string; signedAt?: string }) {
    return this.service.update(id, body);
  }
}