import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NasService } from './nas.service';
import { ProfilesService } from './profiles.service';
import { CreateNasDto, UpdateNasDto, CreateProfileDto, UpdateProfileDto } from './dto/nas.dto';

const NOC_ROLES = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'NOC_ENGINEER'] as const;

/**
 * NAS (router) management for the NOC console. Rows live in the MariaDB `nas`
 * table that FreeRADIUS reads when `read_clients = yes` (see radius/README.md).
 * Secrets are write-only — GET responses only include a masked preview.
 */
@ApiTags('radius-nas')
@Controller('radius/nas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NasController {
  constructor(private readonly nas: NasService) {}

  @Get()
  @Roles(...NOC_ROLES)
  list() {
    return this.nas.list();
  }

  @Get(':id')
  @Roles(...NOC_ROLES)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.nas.findOne(id);
  }

  @Post()
  @Roles(...NOC_ROLES)
  create(@Body() dto: CreateNasDto) {
    return this.nas.create(dto);
  }

  @Patch(':id')
  @Roles(...NOC_ROLES)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateNasDto) {
    return this.nas.update(id, dto);
  }

  @Delete(':id')
  @Roles(...NOC_ROLES)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.nas.remove(id);
  }

  @Post(':id/test')
  @Roles(...NOC_ROLES)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.nas.test(id);
  }
}

/**
 * PPPoE profiles backed by RADIUS groups (radgroupreply). Assigning a profile
 * to a customer is done through `/customers/:id/radius/profile`.
 */
@ApiTags('radius-profiles')
@Controller('radius/profiles')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @Roles(...NOC_ROLES)
  list() {
    return this.profiles.list();
  }

  @Get(':name')
  @Roles(...NOC_ROLES)
  findOne(@Param('name') name: string) {
    return this.profiles.findOne(name);
  }

  @Post()
  @Roles(...NOC_ROLES)
  create(@Body() dto: CreateProfileDto) {
    return this.profiles.create(dto);
  }

  @Patch(':name')
  @Roles(...NOC_ROLES)
  update(@Param('name') name: string, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(name, dto);
  }

  @Delete(':name')
  @Roles(...NOC_ROLES)
  remove(@Param('name') name: string, @Query('force') force?: string) {
    return this.profiles.remove(name, force === 'true');
  }
}
