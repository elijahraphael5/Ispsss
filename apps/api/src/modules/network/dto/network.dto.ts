import { IsString, IsNotEmpty, IsOptional, IsIP, Validate } from 'class-validator';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'isAllowedDeviceIp', async: false })
export class IsAllowedDeviceIpConstraint implements ValidatorConstraintInterface {
  validate(ip: string) {
    if (!ip || typeof ip !== 'string') return false;
    // Basic IP format already checked by IsIP, now check disallowed ranges
    // Reject loopback 127.0.0.0/8, link-local 169.254.0.0/16, multicast 224.0.0.0/4, 0.0.0.0/8, broadcast
    if (ip === '0.0.0.0' || ip === '255.255.255.255') return false;
    if (ip.startsWith('127.')) return false;
    if (ip.startsWith('169.254.')) return false;
    if (ip.startsWith('224.') || ip.startsWith('239.')) return false; // multicast
    // Check multicast 224.0.0.0/4 => first octet 224-239
    const firstOctet = parseInt(ip.split('.')[0], 10);
    if (firstOctet >= 224 && firstOctet <= 239) return false;
    if (firstOctet === 0) return false;
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} ${args.value} is not allowed (loopback/link-local/multicast/reserved)`;
  }
}

export class CreateNetworkDeviceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsIP('4')
  @Validate(IsAllowedDeviceIpConstraint)
  ipAddress!: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  secret?: string;
}

export class UpdateNetworkDeviceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsIP('4')
  @Validate(IsAllowedDeviceIpConstraint)
  ipAddress?: string;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  secret?: string;
}
