import { Module } from '@nestjs/common';
import { ConfigifyModule } from '@itgorillaz/configify';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { InfrastructrueModule } from './infrastructure/infrastructure.module';


@Module({
  imports: [
    PrismaModule,
    ConfigifyModule.forRootAsync(),
    InfrastructrueModule
  ],

})
export class AppModule { }
