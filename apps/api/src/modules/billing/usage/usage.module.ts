import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { UsageService } from "./usage.service";
import { UsageController } from "./usage.controller";
import { RedisModule } from "../../../infrastructure/redis/redis.module";
import { EmailModule } from "../../../infrastructure/mails/email.module";
import { QUEUE_NAMES } from "../../../infrastructure/queue/queue.constant";

@Module({
  imports: [
    RedisModule,
    EmailModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.BILLING,
    }),
  ],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
