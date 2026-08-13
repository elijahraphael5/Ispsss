import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NocService } from './noc.service';

@ApiTags('noc')
@Controller('noc')
export class NocController {
  constructor(private readonly service: NocService) {}

  @Get()
  findAll() {
    // TODO: implement — see docs/refined-spec.md § Noc Module
    return this.service.findAll();
  }
}
