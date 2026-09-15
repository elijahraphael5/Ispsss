import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateCoverageZoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  slug?: string;
}

export class UpdateCoverageZoneDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  slug?: string;
}
