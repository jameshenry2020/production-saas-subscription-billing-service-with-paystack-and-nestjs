import { Module, forwardRef } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionController } from "./subscription.controller";
import { BillingModule } from "../billing.module";
import { AuthModule } from "../../auth/auth.module";
import { UserModule } from "../../users/user.module";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service";
import { SubscriptionSchedulerService } from "../../../infrastructure/queue/producers/subscription-scheduler.service";
import { BillingProcessor } from "../../../infrastructure/queue/consumers/billing.processor";
import { SystemSettingModule } from "../../../infrastructure/settings/system-setting.module";

@Module({
  imports: [
    BillingModule,
    forwardRef(() => AuthModule),
    UserModule,
    SystemSettingModule,
    BullModule.registerQueue({
      name: "billing",
    }),
  ],
  controllers: [SubscriptionController],
  providers: [
    SubscriptionService,
    IdempotencyService,
    SubscriptionSchedulerService,
    BillingProcessor,
  ],
  exports: [
    SubscriptionService,
    IdempotencyService,
    SubscriptionSchedulerService,
    BillingProcessor,
  ],
})
export class SubscriptionModule {}