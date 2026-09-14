import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { RadiusService } from './radius.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { RadiusMutationGuard } from './radius-mutation.guard';

/**
 * Internal endpoints used by billing/payments after the corresponding state
 * transitions (invoice -> OVERDUE = deactivate, payment confirmed = activate).
 * Not JWT-protected; guarded by the shared WEBHOOK_SERVICE_TOKEN when set.
 */
@Controller('internal/radius')
export class RadiusInternalController {
  constructor(private readonly radius: RadiusService) {}

  private assertToken(token: string | undefined): void {
    const expected = process.env.WEBHOOK_SERVICE_TOKEN;
    if (!expected) {
      throw new ForbiddenException('WEBHOOK_SERVICE_TOKEN not configured — internal endpoints disabled');
    }
    const a = Buffer.from(String(token ?? ''), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new ForbiddenException('Missing or invalid webhook token');
    }
  }

  @Post('customers/:id/activate')
  @UseGuards(RadiusMutationGuard)
  activate(@Param('id') id: string, @Body() body: { password?: string; expiresAt?: string }, @Headers('x-webhook-token') token?: string) {
    this.assertToken(token);
    return this.radius.activate(id, body);
  }

  @Post('customers/:id/deactivate')
  @UseGuards(RadiusMutationGuard)
  deactivate(@Param('id') id: string, @Headers('x-webhook-token') token?: string) {
    this.assertToken(token);
    return this.radius.deactivate(id);
  }

  @Post('customers/:id/change-plan')
  @UseGuards(RadiusMutationGuard)
  changePlan(
    @Param('id') id: string,
    @Body() body: ChangePlanDto,
    @Headers('x-webhook-token') token?: string,
  ) {
    this.assertToken(token);
    return this.radius.changePlan(id, body.rateLimit);
  }
}