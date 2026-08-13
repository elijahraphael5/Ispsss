import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Get()
  findAll() {
    // TODO: implement — see docs/refined-spec.md § Auth Module
    return this.service.findAll();
  }
}
