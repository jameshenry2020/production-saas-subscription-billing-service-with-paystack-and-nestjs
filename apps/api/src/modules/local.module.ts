import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { UserService } from "./users/user.service";
import { UserModule } from "./users/user.module";



@Module({
    imports: [AuthModule, BillingModule, UserModule],
    providers: [],
    exports: []
})
export class LocalModule {

}