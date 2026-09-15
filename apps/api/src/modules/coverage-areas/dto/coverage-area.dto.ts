import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export const COVERAGE_ZONES = ['LAGOS_MAINLAND', 'LAGOS_ISLAND', 'IKORODU', 'OTHER'];
export const COVERAGE_STATUSES = ['COVERED', 'IN_PROGRESS', 'PLANNED'];
export const COVERAGE_TECHNOLOGIES = ['FIBER', 'RADIO'];

export class CreateCoverageAreaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lga?: string;

  @IsOptional()
  @IsIn(COVERAGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(COVERAGE_TECHNOLOGIES)
  technology?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'lat must be a number between -90 and 90' })
  @Min(-90, { message: 'lat must not be less than -90' })
  @Max(90, { message: 'lat must not be greater than 90' })
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'lng must be a number between -180 and 180' })
  @Min(-180, { message: 'lng must not be less than -180' })
  @Max(180, { message: 'lng must not be greater than 180' })
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateCoverageAreaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lga?: string;

  @IsOptional()
  @IsIn(COVERAGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(COVERAGE_TECHNOLOGIES)
  technology?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'lat must be a number between -90 and 90' })
  @Min(-90, { message: 'lat must not be less than -90' })
  @Max(90, { message: 'lat must not be greater than 90' })
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'lng must be a number between -180 and 180' })
  @Min(-180, { message: 'lng must not be less than -180' })
  @Max(180, { message: 'lng must not be greater than 180' })
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
