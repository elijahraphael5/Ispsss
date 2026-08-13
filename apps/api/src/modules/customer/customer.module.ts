import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SupportModule } from '../support/support.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [PrismaModule, SupportModule],
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}
