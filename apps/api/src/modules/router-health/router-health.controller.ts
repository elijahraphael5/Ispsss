import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('router-health')
@Controller('router-health')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RouterHealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER', 'SUPPORT_AGENT', 'CUSTOMER_SUPPORT', 'SALES_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  getAll() {
    return this.prisma.routerHealth.findMany({ include: { device: true } });
  }
}
