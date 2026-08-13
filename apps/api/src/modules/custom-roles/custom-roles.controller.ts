import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CustomRolesService } from './custom-roles.service';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';

@ApiTags('custom-roles')
@Controller('custom-roles')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CustomRolesController {
  constructor(private readonly service: CustomRolesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  create(@Body() dto: CreateCustomRoleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateCustomRoleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
