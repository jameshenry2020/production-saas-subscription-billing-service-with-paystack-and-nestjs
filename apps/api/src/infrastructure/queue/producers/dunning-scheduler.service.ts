import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QUEUE_NAMES, JOB_NAMES } from "../queue.constant";

@Injectable()
export class DunningSchedulerService {
  private readonly logger = new Logger(DunningSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.BILLING) private readonly billingQueue: Queue
  ) {}

  /**
   * Periodic cron sweep to find scheduled dunning retries that are due.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleDunningSweep() {
    this.logger.log("Starting dunning sweep...");
    try {
      const now = new Date();
      const pendingRetries = await this.prisma.dunningAttempt.findMany({
        where: {
          scheduledAt: { lte: now },
          status: "SCHEDULED",
        },
      });

      this.logger.log(`Found ${pendingRetries.length} pending dunning retries due.`);

      for (const retry of pendingRetries) {
        this.logger.log(`Enqueuing dunning retry job for attempt ${retry.id} (Invoice: ${retry.invoiceId})`);
        await this.billingQueue.add(JOB_NAMES.EXECUTE_DUNNING_RETRY, {
          dunningAttemptId: retry.id,
        });
      }
    } catch (error: any) {
      this.logger.error(`Dunning sweep cron failed: ${error.message}`, error.stack);
    }
  }
}
