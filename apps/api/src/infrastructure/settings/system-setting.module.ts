import { Module } from "@nestjs/common";
import { SystemSettingService } from "./system-setting.service";

@Module({
  providers: [SystemSettingService],
  exports: [SystemSettingService],
})
export class SystemSettingModule {}
