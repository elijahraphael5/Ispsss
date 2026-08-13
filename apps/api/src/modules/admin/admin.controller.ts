import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('dashboard')
  @Roles('SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER')
  dashboard() {
    return this.service.getDashboard();
  }
}
