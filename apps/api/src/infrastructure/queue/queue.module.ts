import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { RedisConfiguration } from "../../config/app-config";

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
    BullModule.registerQueue({
      name: "billing",
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
