import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RedisConfiguration } from "../../config/app-config";
import { QUEUE_NAMES } from "./queue.constant";

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [RedisConfiguration],
      useFactory: (redisConfig: RedisConfiguration) => ({
        connection: {
          host: redisConfig.host,
          port: parseInt(redisConfig.port, 10),
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.BILLING },
      { name: QUEUE_NAMES.EMAIL }
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
