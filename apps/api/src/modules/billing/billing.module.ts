import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PaystackService } from "./paystack/paystack.service";
import { SubscriptionService } from "./subscription/subscription.service";

@Module({
  controllers: [BillingController],
  providers: [BillingService, PaystackService, SubscriptionService],
  exports: [BillingService, PaystackService, SubscriptionService],
})
export class BillingModule {}