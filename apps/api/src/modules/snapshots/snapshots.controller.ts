import { Controller, Get, Post, Delete, Param, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SnapshotsService } from './snapshots.service';

@ApiTags('snapshots')
@Controller('snapshots')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SUPER_ADMIN')
export class SnapshotsController {
  constructor(private readonly snapshots: SnapshotsService) {}

  @Get()
  list() {
    return this.snapshots.list();
  }

  @Post()
  create() {
    return this.snapshots.create();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded (field: file)');
    // Basic validation: must be .dump or .sql
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.dump') && !name.endsWith('.sql')) {
      throw new BadRequestException('Only .dump (pg_dump -Fc) or .sql files are accepted');
    }
    return this.snapshots.saveUpload(file);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const full = this.snapshots.getPath(id);
    res.download(full, full.split('/').pop()!);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    // restore is destructive — caller should confirm in UI (PURGE-style)
    return this.snapshots.restore(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.snapshots.delete(id);
  }
}
