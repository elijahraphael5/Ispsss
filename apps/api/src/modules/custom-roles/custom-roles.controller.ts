import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomRolesService } from './custom-roles.service';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';

@ApiTags('custom-roles')
@Controller('custom-roles')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class CustomRolesController {
  constructor(private readonly service: CustomRolesService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'OPERATIONS_MANAGER')
  findAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.findAll({ skip: skip ? parseInt(skip, 10) : undefined, take: take ? parseInt(take, 10) : undefined });
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
  remove(@Param('id') id: string, @CurrentUser() actor: { id: string; isSuperAdmin?: boolean; customRole?: { name: string } | null }) {
    return this.service.remove(id, actor);
  }
}
