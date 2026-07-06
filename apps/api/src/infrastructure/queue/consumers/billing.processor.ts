import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { SubscriptionService } from "../../../modules/billing/subscription/subscription.service";
import { SubscriptionStatus } from "prisma/generated/prisma/client";
import { computePeriodEnd } from "../../../utils/billing-helper";
import { QUEUE_NAMES, JOB_NAMES } from "../queue.constant";

@Processor(QUEUE_NAMES.BILLING)
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case JOB_NAMES.PROCESS_DOWNGRADE:
        await this.handleProcessDowngrade(job.data);
        break;
      case JOB_NAMES.RECONCILE_PAYMENT:
        await this.handleReconcilePayment(job.data);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleProcessDowngrade(data: {
    subscriptionId: string;
    changeId: string;
    targetPlanId: string;
    targetPriceId: string;
  }) {
    const { subscriptionId, targetPlanId, targetPriceId } = data;
    this.logger.log(`Applying downgrade for subscription ${subscriptionId}`);

    await this.prisma.$transaction(async (tx) => {
      const currentSub = await tx.subscription.findUnique({
        where: { id: subscriptionId },
      });

      if (!currentSub) {
        throw new Error(`Subscription ${subscriptionId} not found`);
      }

      // If already matching target plan/price, skip
      if (currentSub.planId === targetPlanId && currentSub.priceId === targetPriceId) {
        this.logger.log(`Subscription ${subscriptionId} is already updated to plan ${targetPlanId}.`);
        return;
      }

      const targetPrice = await tx.price.findUnique({
        where: { id: targetPriceId },
      });

      if (!targetPrice) {
        throw new Error(`Target price ${targetPriceId} not found`);
      }

      const newPeriodEnd = computePeriodEnd(targetPrice.interval);

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          planId: targetPlanId,
          priceId: targetPriceId,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: new Date(),
          currentPeriodEnd: newPeriodEnd,
        },
      });

      this.logger.log(`Successfully completed downgrade for subscription ${subscriptionId}`);
    });
  }

  private async handleReconcilePayment(data: { paymentId: string; reference: string }) {
    const { paymentId, reference } = data;
    this.logger.log(`Reconciling payment ${paymentId} with Paystack (Reference: ${reference})`);

    try {
      const paystackTx = await this.subscriptionService.paystack.verifyTransaction(reference);

      if (paystackTx.status === "success") {
        this.logger.log(`Reconciliation success: payment ${paymentId} succeeded on Paystack.`);
        await this.subscriptionService.processSuccessfulPayment(reference, paystackTx);
      } else if (paystackTx.status === "failed") {
        this.logger.log(`Reconciliation failure: payment ${paymentId} failed on Paystack.`);
        await this.prisma.$transaction(async (tx) => {
          await tx.subscriptionPayment.update({
            where: { id: paymentId },
            data: { status: "FAILED" },
          });
          await tx.transaction.update({
            where: { paystackReference: reference },
            data: { status: "FAILED" },
          });
        });
      } else {
        this.logger.log(`Reconciliation: payment ${paymentId} status on Paystack is ${paystackTx.status}. Keeping PENDING.`);
      }
    } catch (error: any) {
      this.logger.error(`Error during payment reconciliation for ${paymentId}: ${error.message}`);
      throw error;
    }
  }
}
