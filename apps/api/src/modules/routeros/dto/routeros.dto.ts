import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';

export class UpdatePppSecretDto {
  @IsOptional() @IsString() @MaxLength(64)
  name?: string;

  @IsOptional() @IsString() @MaxLength(128)
  password?: string;

  @IsOptional() @IsString() @MaxLength(64)
  profile?: string;

  @IsOptional() @IsString() @MaxLength(500)
  comment?: string;

  @IsOptional() @IsIn(['yes', 'no', 'true', 'false'])
  disabled?: string;
}
