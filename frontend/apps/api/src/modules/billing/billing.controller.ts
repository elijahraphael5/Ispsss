import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Get()
  findAll() {
    // TODO: implement — see docs/refined-spec.md § Billing Module
    return this.service.findAll();
  }
}
