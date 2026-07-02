import { Module } from "@nestjs/common";
import { EmailModule } from "./mails/email.module";


@Module({
    imports: [EmailModule],
    exports: [EmailModule]
})
export class InfrastructrueModule {

}