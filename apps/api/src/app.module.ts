import { Module } from '@nestjs/common';
import { ConfigifyModule } from '@itgorillaz/configify';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { InfrastructrueModule } from './infrastructure/infrastructure.module';
import { BillingModule } from './modules/billing/billing.module';
import { LocalModule } from './modules/local.module';


@Module({
  imports: [
    PrismaModule,
    ConfigifyModule.forRootAsync(),
    InfrastructrueModule,
    LocalModule
  ],

})
export class AppModule { }
