import { Module } from "@nestjs/common";
import { EmailModule } from "./mails/email.module";
import { QueueModule } from "./queue/queue.module";
import { SystemSettingModule } from "./settings/system-setting.module";


@Module({
    imports: [EmailModule, QueueModule, SystemSettingModule],
    exports: [EmailModule, QueueModule]
})
export class InfrastructrueModule {

}