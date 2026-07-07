import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionController } from "./subscription.controller";
import { BillingModule } from "../billing.module";
import { AuthModule } from "../../auth/auth.module";
import { UserModule } from "../../users/user.module";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service";
import { SubscriptionSchedulerService } from "../../../infrastructure/queue/producers/subscription-scheduler.service";
import { BillingSchedulerService } from "../../../infrastructure/queue/producers/billing-scheduler.service";
import { DunningSchedulerService } from "../../../infrastructure/queue/producers/dunning-scheduler.service";
import { BillingProcessor } from "../../../infrastructure/queue/consumers/billing.processor";
import { SystemSettingModule } from "../../../infrastructure/settings/system-setting.module";
import { UsageModule } from "../usage/usage.module";
import { EmailModule } from "../../../infrastructure/mails/email.module";

@Module({
  imports: [
    BillingModule,
    forwardRef(() => AuthModule),
    UserModule,
    SystemSettingModule,
    UsageModule,
    EmailModule,
    BullModule.registerQueue({
      name: "billing",
    }),
  ],
  controllers: [SubscriptionController],
  providers: [
    SubscriptionService,
    IdempotencyService,
    SubscriptionSchedulerService,
    BillingSchedulerService,
    DunningSchedulerService,
    BillingProcessor,
  ],
  exports: [
    SubscriptionService,
    IdempotencyService,
    SubscriptionSchedulerService,
    BillingSchedulerService,
    DunningSchedulerService,
    BillingProcessor,
  ],
})
export class SubscriptionModule {}