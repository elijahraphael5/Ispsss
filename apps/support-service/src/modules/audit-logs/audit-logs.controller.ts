import { Controller, Get, Param, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit-logs')
@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AuditLogsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'NOC_ENGINEER')
  findAll(
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.findAll({
      entityType,
      action,
      actorId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Roles('SUPER_ADMIN')
  findOne(@Param('id') id: string) {
    return this.audit.findOne(id);
  }

  @Post(':id/rollback')
  @Roles('SUPER_ADMIN')
  rollback(@Param('id') id: string) {
    return this.audit.rollback(id);
  }
}
