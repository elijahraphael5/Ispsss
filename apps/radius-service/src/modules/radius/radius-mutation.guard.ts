import { CanActivate, ExecutionContext, HttpException, Injectable, Inject } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '@isp/rate-limit';

const MUTATIONS_PER_MINUTE = 10;

/**
 * Per-customer guard for RADIUS mutations (activate/deactivate/change-plan).
 * Flapping a single customer's service dozens of times per minute would spam
 * the NAS with CoA/disconnect packets — cap it at 10/min per customer.
 */
@Injectable()
export class RadiusMutationGuard implements CanActivate {
  constructor(
    @Inject('RADIUS_LIMITER') private readonly limiter: SlidingWindowRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const id: string | undefined = req.params?.id;
    if (!id) return true;

    const result = await this.limiter.consume(`radius:customer:${id}`, {
      limit: MUTATIONS_PER_MINUTE,
      windowMs: 60_000,
    });
    if (!result.allowed) {
      throw new HttpException('Too many RADIUS mutations for this customer', 429);
    }
    return true;
  }
}