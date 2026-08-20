import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RadiusService } from './radius.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { RadiusMutationGuard } from './radius-mutation.guard';

/**
 * RADIUS-wide statistics and configuration overview for the NOC console.
 * Proxied through the gateway at `/api/v1/radius/*`.
 */
@ApiTags('radius-stats')
@Controller('radius')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RadiusStatsController {
  constructor(private readonly radius: RadiusService) {}

  @Get('stats')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER')
  stats() {
    return this.radius.stats();
  }
}

/**
 * Admin-facing RADIUS endpoints. Access through the API gateway at
 * `/api/v1/customers/:id/radius/*` (proxied to this service).
 */
@ApiTags('radius')
@Controller('customers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RadiusController {
  constructor(private readonly radius: RadiusService) {}

  @Post(':id/radius/activate')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER')
  @UseGuards(RadiusMutationGuard)
  activate(@Param('id') id: string, @Body() body: { password?: string; expiresAt?: string } = {}) {
    return this.radius.activate(id, body);
  }

  @Post(':id/radius/deactivate')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER')
  @UseGuards(RadiusMutationGuard)
  deactivate(@Param('id') id: string) {
    return this.radius.deactivate(id);
  }

  @Post(':id/radius/change-plan')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER')
  @UseGuards(RadiusMutationGuard)
  changePlan(@Param('id') id: string, @Body() body: ChangePlanDto) {
    return this.radius.changePlan(id, body.rateLimit);
  }

  @Get(':id/radius/usage')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER', 'SALES_AGENT', 'CEO', 'CUSTOMER_SUPPORT')
  usage(@Param('id') id: string) {
    return this.radius.getUsage(id);
  }
}