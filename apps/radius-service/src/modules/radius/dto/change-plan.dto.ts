import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * MikroTik rate-limit string, e.g. "10M/10M" or "10M/10M 100k/100k 30/30".
 * Up to 3 tx/rx pairs; burst allowed in RouterOS format but not enforced here.
 */
export class ChangePlanDto {
  @ApiProperty({ example: '10M/10M', description: 'MikroTik rate-limit string' })
  @IsString()
  @Matches(/^[0-9]+[kKmMgG]?\/[0-9]+[kKmMgG]?(\s+[0-9]+[kKmMgG]?\/[0-9]+[kKmMgG]?){0,2}$/, {
    message: 'rateLimit must look like "10M/10M" (optionally with burst pairs)',
  })
  rateLimit: string;
}