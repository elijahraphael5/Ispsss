import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}