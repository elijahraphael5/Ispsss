import { IsString, IsOptional, IsNotEmpty, IsEmail, IsNumber, IsBoolean, Min, Max, MaxLength, MinLength } from 'class-validator';

export class UpdateTenantSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  vatRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  invoicePrefix?: string;

  @IsOptional()
  @IsBoolean()
  paystackEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  paystackPublicKey?: string;

  // Write-only: stored encrypted, never returned by the API.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  paystackSecretKey?: string;

  @IsOptional()
  @IsBoolean()
  smtpEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  smtpHost?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  smtpUser?: string;

  // Write-only: stored encrypted, never returned by the API.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  smtpPass?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  smtpFromEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  smtpFromName?: string;
}
