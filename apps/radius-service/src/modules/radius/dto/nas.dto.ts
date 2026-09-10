import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, Min, Max, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateNasDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  nasname!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  shortname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  ports?: number;

  @IsString()
  @MinLength(8)
  @MaxLength(60)
  secret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class UpdateNasDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  nasname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  shortname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  ports?: number;

  // Optional on update: omit/blank to keep the stored secret.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(60)
  secret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class CreateProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'name may only contain letters, numbers, dot, dash and underscore' })
  name!: string;

  // MikroTik rate-limit string, e.g. "10M/10M" or "10M/10M 100k/100k 30/30"
  @IsOptional()
  @IsString()
  @MaxLength(253)
  rateLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sessionTimeout?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  idleTimeout?: number;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  framedPool?: string;

  // true = this profile always assigns a fixed per-subscriber Framed-IP-Address
  @IsOptional()
  @IsBoolean()
  staticIpMode?: boolean;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(253)
  rateLimit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sessionTimeout?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  idleTimeout?: number;

  @IsOptional()
  @IsString()
  @MaxLength(253)
  framedPool?: string;

  @IsOptional()
  @IsBoolean()
  staticIpMode?: boolean;
}
