import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

@ApiTags('router-health')
@Controller('router-health')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RouterHealthController {
  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  @Get()
  @Roles('NOC_ENGINEER', 'CEO', 'OPERATIONS_MANAGER', 'SUPER_ADMIN', 'FIELD_ENGINEER', 'SUPPORT_AGENT', 'CUSTOMER_SUPPORT', 'SALES_AGENT', 'BILLING_OFFICER', 'FINANCE_MANAGER')
  async getAll() {
    const cached = await this.cache.get<any[]>('router-health:all');
    if (cached) return cached;
    const rows = await this.prisma.routerHealth.findMany({ include: { device: true } });
    await this.cache.set('router-health:all', rows, 10);
    return rows;
  }
}
