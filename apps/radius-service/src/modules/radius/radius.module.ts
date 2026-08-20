import { Module } from '@nestjs/common';
import { CacheService, NoopCacheClient, RedisCacheClient } from '@isp/cache';
import { MemoryRateLimitStore, SlidingWindowRateLimiter } from '@isp/rate-limit';
import Redis from 'ioredis';
import { RadiusController, RadiusStatsController } from './radius.controller';
import { RadiusInternalController } from './radius.internal.controller';
import { RadiusService } from './radius.service';
import { RadiusDbService } from './radius-db.service';
import { CoaService } from './coa.service';
import { RadiusMutationGuard } from './radius-mutation.guard';

@Module({
  controllers: [RadiusController, RadiusStatsController, RadiusInternalController],
  providers: [
    RadiusService,
    RadiusDbService,
    CoaService,
    RadiusMutationGuard,
    {
      provide: 'RADIUS_CACHE',
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL ?? 'none';
        return new CacheService(
          redisUrl === 'none' ? new NoopCacheClient() : new RedisCacheClient(new Redis(redisUrl)),
        );
      },
    },
    {
      provide: 'RADIUS_LIMITER',
      useFactory: () => new SlidingWindowRateLimiter(new MemoryRateLimitStore()),
    },
  ],
  exports: [RadiusService],
})
export class RadiusModule {}