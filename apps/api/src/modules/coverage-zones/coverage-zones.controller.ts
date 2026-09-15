import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CoverageZonesService } from './coverage-zones.service';
import { CreateCoverageZoneDto, UpdateCoverageZoneDto } from './dto/coverage-zone.dto';

const WRITE_ROLES = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER'] as const;

@ApiTags('coverage-zones')
@Controller('coverage-zones')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CoverageZonesController {
  constructor(private readonly service: CoverageZonesService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateCoverageZoneDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateCoverageZoneDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
