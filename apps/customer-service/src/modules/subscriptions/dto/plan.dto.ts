import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, Min, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export const PLAN_TYPES = ['FIBER', 'RADIO', 'ENTERPRISE', 'CUSTOM'] as const;
export const PLAN_TECHNOLOGIES = ['RADIO', 'FIBER', 'DIA'] as const;

export class CreatePlanDto {
  @IsString() @IsNotEmpty() @MaxLength(120)
  name!: string;

  @IsOptional() @IsIn(PLAN_TYPES)
  type?: typeof PLAN_TYPES[number];

  @IsOptional() @IsIn(PLAN_TECHNOLOGIES)
  technology?: typeof PLAN_TECHNOLOGIES[number];

  @IsOptional() @IsString() @MaxLength(50)
  category?: string;

  @IsOptional() @IsString() @IsIn(['BRONZE', 'SILVER', 'GOLD'])
  level?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  speedMbps?: number;

  @IsOptional() @IsString() @MaxLength(40)
  speedLabel?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  targetUsers?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  dataCapGb?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  fairUsageGb?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  priceKobo?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  installationFeeKobo?: number;

  @IsOptional() @IsString() @MaxLength(20)
  contentionRatio?: string;

  @IsOptional() @IsBoolean()
  staticIp?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sla?: number;

  @IsOptional() @IsBoolean()
  routerIncluded?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  contractDuration?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  features?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120)
  name?: string;

  @IsOptional() @IsIn(PLAN_TYPES)
  type?: typeof PLAN_TYPES[number];

  @IsOptional() @IsIn(PLAN_TECHNOLOGIES)
  technology?: typeof PLAN_TECHNOLOGIES[number];

  @IsOptional() @IsString() @MaxLength(50)
  category?: string;

  @IsOptional() @IsString() @IsIn(['BRONZE', 'SILVER', 'GOLD'])
  level?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  speedMbps?: number;

  @IsOptional() @IsString() @MaxLength(40)
  speedLabel?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  targetUsers?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  dataCapGb?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  fairUsageGb?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  priceKobo?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  installationFeeKobo?: number;

  @IsOptional() @IsString() @MaxLength(20)
  contentionRatio?: string;

  @IsOptional() @IsBoolean()
  staticIp?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sla?: number;

  @IsOptional() @IsBoolean()
  routerIncluded?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  contractDuration?: number;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  features?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
