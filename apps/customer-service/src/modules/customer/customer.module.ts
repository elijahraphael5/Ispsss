import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { SupportClientService } from './support-client.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerService, SupportClientService],
  exports: [SupportClientService],
})
export class CustomerModule {}