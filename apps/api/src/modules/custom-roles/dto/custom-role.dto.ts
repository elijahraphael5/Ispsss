import { IsString, IsBoolean, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PermissionDto {
  @IsString()
  module: string;

  @IsBoolean()
  canView: boolean;

  @IsBoolean()
  canCreate: boolean;

  @IsBoolean()
  canEdit: boolean;

  @IsBoolean()
  canDelete: boolean;
}

export class CreateCustomRoleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateNested({ each: true })
  @Type(() => PermissionDto)
  permissions: PermissionDto[];
}

export class UpdateCustomRoleDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ValidateNested({ each: true })
  @IsOptional()
  @Type(() => PermissionDto)
  permissions?: PermissionDto[];
}
