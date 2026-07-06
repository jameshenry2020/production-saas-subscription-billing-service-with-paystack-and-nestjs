import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { UserService } from "./users/user.service";
import { UserModule } from "./users/user.module";
import { SubscriptionModule } from "./billing/subscription/subscription.module";
import { WebhookModule } from "./billing/webhook/webhook.module";

@Module({
    imports: [AuthModule, BillingModule, UserModule, SubscriptionModule, WebhookModule],
    providers: [],
    exports: []
})
export class LocalModule {

}