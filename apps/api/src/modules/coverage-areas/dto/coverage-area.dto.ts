import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, MaxLength, Min, Max } from 'class-validator';

export const COVERAGE_ZONES = ['LAGOS_MAINLAND', 'LAGOS_ISLAND', 'IKORODU', 'OTHER'];
export const COVERAGE_STATUSES = ['COVERED', 'IN_PROGRESS', 'PLANNED'];

export class CreateCoverageAreaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(COVERAGE_ZONES)
  zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lga?: string;

  @IsOptional()
  @IsIn(COVERAGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
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
  @IsIn(COVERAGE_ZONES)
  zone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lga?: string;

  @IsOptional()
  @IsIn(COVERAGE_STATUSES)
  status?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
