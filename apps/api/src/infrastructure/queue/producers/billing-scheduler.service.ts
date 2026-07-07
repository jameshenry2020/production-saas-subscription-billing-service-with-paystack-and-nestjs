import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SubscriptionStatus } from "prisma/generated/prisma/client";
import { QUEUE_NAMES, JOB_NAMES } from "../queue.constant";

@Injectable()
export class BillingSchedulerService {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.BILLING) private readonly billingQueue: Queue
  ) {}

  /**
   * Daily cron sweep at midnight to find subscriptions whose current period has ended
   * and need to be processed for renewal.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRenewalSweep() {
    this.logger.log("Starting daily billing renewal sweep...");
    try {
      const now = new Date();
      const subscriptionsDue = await this.prisma.subscription.findMany({
        where: {
          currentPeriodEnd: { lte: now },
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.TRIALING] },
        },
      });

      this.logger.log(`Found ${subscriptionsDue.length} subscriptions due for renewal.`);

      for (const sub of subscriptionsDue) {
        this.logger.log(`Enqueuing renewal job for subscription ${sub.id}`);
        await this.billingQueue.add(JOB_NAMES.PROCESS_RENEWAL, {
          subscriptionId: sub.id,
        });
      }
    } catch (error: any) {
      this.logger.error(`Renewal cron sweep failed: ${error.message}`, error.stack);
    }
  }
}
