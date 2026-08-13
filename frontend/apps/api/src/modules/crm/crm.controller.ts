import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CrmService } from './crm.service';

@ApiTags('crm')
@Controller('crm')
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get()
  findAll() {
    // TODO: implement — see docs/refined-spec.md § Crm Module
    return this.service.findAll();
  }
}
