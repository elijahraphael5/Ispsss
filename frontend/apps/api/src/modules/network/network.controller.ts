import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NetworkService } from './network.service';

@ApiTags('network')
@Controller('network')
export class NetworkController {
  constructor(private readonly service: NetworkService) {}

  @Get()
  findAll() {
    // TODO: implement — see docs/refined-spec.md § Network Module
    return this.service.findAll();
  }
}
