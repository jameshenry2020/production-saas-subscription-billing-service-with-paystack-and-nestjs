import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../database/prisma.service";
import { SubscriptionService } from "../../../modules/billing/subscription/subscription.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SubscriptionChangeType } from "prisma/generated/prisma/client";
import { QUEUE_NAMES, JOB_NAMES } from "../queue.constant";

@Injectable()
export class SubscriptionSchedulerService {
  private readonly logger = new Logger(SubscriptionSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    @InjectQueue(QUEUE_NAMES.BILLING) private readonly billingQueue: Queue
  ) {}

  /**
   * Cron job running periodically to sweep and process scheduled downgrades
   * and pending payment reconciliations.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleBillingCronSweep() {
    this.logger.log("Starting billing cron sweep...");
    try {
      await this.enqueueScheduledDowngrades();
      await this.enqueuePendingPaymentsReconciliation();
    } catch (err: any) {
      this.logger.error(`Billing cron sweep failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Finds all scheduled downgrades where effectiveAt has passed,
   * and enqueues a background BullMQ job to process each transition.
   */
  async enqueueScheduledDowngrades() {
    const now = new Date();
    const pendingDowngrades = await this.prisma.subscriptionChange.findMany({
      where: {
        changeType: SubscriptionChangeType.DOWNGRADE,
        effectiveAt: { lte: now },
      },
      include: {
        subscription: true,
      },
    });

    this.logger.log(`Found ${pendingDowngrades.length} scheduled downgrades due for execution.`);

    for (const change of pendingDowngrades) {
      // Check if subscription has already been updated to prevent redundant work
      if (
        change.subscription.planId === change.toPlanId &&
        change.subscription.priceId === change.toPriceId
      ) {
        continue;
      }

      this.logger.log(`Enqueuing downgrade job for subscription ${change.subscriptionId} to plan ${change.toPlanId}`);
      await this.billingQueue.add(JOB_NAMES.PROCESS_DOWNGRADE, {
        subscriptionId: change.subscriptionId,
        changeId: change.id,
        targetPlanId: change.toPlanId,
        targetPriceId: change.toPriceId,
      });
    }
  }

  /**
   * Finds all pending SubscriptionPayments older than 15 minutes,
   * and enqueues a background BullMQ job to reconcile with Paystack.
   */
  async enqueuePendingPaymentsReconciliation() {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const pendingPayments = await this.prisma.subscriptionPayment.findMany({
      where: {
        status: "PENDING",
        createdAt: { lte: fifteenMinutesAgo },
      },
    });

    this.logger.log(`Found ${pendingPayments.length} pending payments due for reconciliation.`);

    for (const payment of pendingPayments) {
      this.logger.log(`Enqueuing reconciliation job for payment ${payment.id} (Ref: ${payment.paystackReference})`);
      await this.billingQueue.add(JOB_NAMES.RECONCILE_PAYMENT, {
        paymentId: payment.id,
        reference: payment.paystackReference,
      });
    }
  }
}
