import { Module } from "@nestjs/common";
import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";
import { SubscriptionModule } from "../subscription/subscription.module";
import { EmailModule } from "../../../infrastructure/mails/email.module";
import { SystemSettingModule } from "../../../infrastructure/settings/system-setting.module";

@Module({
  imports: [SubscriptionModule, EmailModule, SystemSettingModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}

