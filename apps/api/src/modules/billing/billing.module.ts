import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PaystackService } from "./paystack/paystack.service";
import { SubscriptionService } from "./subscription/subscription.service";
import { AuthModule } from "../auth/auth.module";
import { UserModule } from "../users/user.module";

@Module({
  imports: [AuthModule, UserModule],
  controllers: [BillingController],
  providers: [BillingService, PaystackService, SubscriptionService],
  exports: [BillingService, PaystackService, SubscriptionService],
})
export class BillingModule {}