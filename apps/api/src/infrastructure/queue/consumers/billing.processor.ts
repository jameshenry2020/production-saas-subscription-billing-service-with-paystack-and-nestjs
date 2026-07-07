import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { SubscriptionService } from "../../../modules/billing/subscription/subscription.service";
import { UsageService } from "../../../modules/billing/usage/usage.service";
import { EmailQueueService } from "../../../infrastructure/mails/email-queue.service";
import { RedisService } from "../../../infrastructure/redis/redis.service";
import { SubscriptionStatus, UsagePeriodStatus, SubscriptionPaymentStatus, InvoiceItemType } from "prisma/generated/prisma/client";
import { computePeriodEnd } from "../../../utils/billing-helper";
import { QUEUE_NAMES, JOB_NAMES } from "../queue.constant";
import * as crypto from "crypto";

@Processor(QUEUE_NAMES.BILLING)
export class BillingProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly usageService: UsageService,
    private readonly emailQueue: EmailQueueService,
    private readonly redis: RedisService
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
      case JOB_NAMES.RECORD_USAGE:
        await this.handleRecordUsage(job.data);
        break;
      case JOB_NAMES.PROCESS_RENEWAL:
        await this.handleProcessRenewal(job.data);
        break;
      case JOB_NAMES.EXECUTE_DUNNING_RETRY:
        await this.handleExecuteDunningRetry(job.data);
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

  private async handleRecordUsage(data: {
    subscriptionId: string;
    customerId: string;
    featureId: string;
    quantity: number;
    idempotencyKey?: string;
  }) {
    const { subscriptionId, customerId, featureId, quantity, idempotencyKey } = data;
    this.logger.log(`Recording usage in database: sub=${subscriptionId}, qty=${quantity}`);
    try {
      await this.prisma.$transaction(async (tx) => {
        // Idempotency check for usage records
        if (idempotencyKey) {
          const existing = await tx.usageRecord.findUnique({
            where: { idempotencyKey },
          });
          if (existing) {
            this.logger.warn(`Usage record with idempotency key ${idempotencyKey} already processed. Skipping.`);
            return;
          }
        }

        // Create UsageRecord
        await tx.usageRecord.create({
          data: {
            subscriptionId,
            customerId,
            featureId,
            quantity,
            idempotencyKey,
            source: "api",
          },
        });

        // Fetch active period of subscription to identify summary
        const sub = await tx.subscription.findUnique({
          where: { id: subscriptionId },
        });

        if (!sub) {
          throw new Error(`Subscription ${subscriptionId} not found`);
        }

        // Update UsageSummary total
        const summary = await tx.usageSummary.findUnique({
          where: {
            subscriptionId_featureId_periodStart_periodEnd: {
              subscriptionId,
              featureId,
              periodStart: sub.currentPeriodStart,
              periodEnd: sub.currentPeriodEnd,
            },
          },
        });

        if (summary) {
          const limit = summary.includedLimit ?? 0;
          const newTotal = summary.totalUsage + quantity;
          let overageUnits = 0;
          let overageAmount = 0;

          const pf = await tx.planFeature.findUnique({
            where: {
              planId_featureId: {
                planId: sub.planId,
                featureId,
              },
            },
          });

          if (pf && pf.overageAllowed && newTotal > limit) {
            overageUnits = newTotal - limit;
            overageAmount = overageUnits * (pf.overageUnitPrice ?? 0);
          }

          await tx.usageSummary.update({
            where: { id: summary.id },
            data: {
              totalUsage: newTotal,
              overageUnits,
              overageAmount,
            },
          });
        } else {
          // If no summary exists yet, initialize it
          const pf = await tx.planFeature.findUnique({
            where: {
              planId_featureId: {
                planId: sub.planId,
                featureId,
              },
            },
          });

          await tx.usageSummary.create({
            data: {
              subscriptionId,
              featureId,
              periodStart: sub.currentPeriodStart,
              periodEnd: sub.currentPeriodEnd,
              totalUsage: quantity,
              includedLimit: pf ? pf.limit : null,
              status: "OPEN",
            },
          });
        }
      });
    } catch (error: any) {
      this.logger.error(`Failed to record usage in database: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async handleProcessRenewal(data: { subscriptionId: string }) {
    const { subscriptionId } = data;
    this.logger.log(`Processing renewal for subscription ${subscriptionId}`);

    try {
      const sub = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          plan: true,
          price: true,
          customer: {
            include: {
              user: true,
              paymentMethods: {
                where: { isReusable: true, isDefault: true },
              },
            },
          },
        },
      });

      if (!sub) {
        throw new Error(`Subscription ${subscriptionId} not found.`);
      }

      // If subscription is not in active or past due state, skip
      if (sub.status !== SubscriptionStatus.ACTIVE && sub.status !== SubscriptionStatus.PAST_DUE) {
        this.logger.warn(`Subscription ${subscriptionId} has status ${sub.status}. Skipping renewal.`);
        return;
      }

      // Check if subscription was set to cancel at period end
      if (sub.cancelAtPeriodEnd) {
        this.logger.log(`Subscription ${subscriptionId} is set to cancel at period end. Processing final overages and cancelling.`);
        await this.handleFinalOverageAndCancel(sub);
        return;
      }

      const nextPeriodStart = sub.currentPeriodEnd;
      const nextPeriodEnd = computePeriodEnd(sub.price.interval, nextPeriodStart);

      await this.prisma.$transaction(async (tx) => {
        // 1. Rollover Usage summaries and get overage items
        const overageItems = await this.usageService.rolloverUsageSummaries(
          tx,
          subscriptionId,
          nextPeriodStart,
          nextPeriodEnd
        );

        // 2. Calculate Renewal Costs
        const baseAmount = sub.price.amount;
        const overageAmount = overageItems.reduce((acc, item) => acc + item.amount, 0);
        const totalAmount = baseAmount + overageAmount;

        // 3. Create Draft Invoice
        const invoiceNumber = `INV-REN-${Date.now()}`;
        const invoice = await tx.invoice.create({
          data: {
            customerId: sub.customerId,
            subscriptionId: sub.id,
            invoiceNumber,
            status: "DRAFT",
            currency: sub.price.currency,
            subtotal: totalAmount,
            total: totalAmount,
            amountDue: totalAmount,
            dueDate: nextPeriodStart,
            periodStart: sub.currentPeriodStart,
            periodEnd: sub.currentPeriodEnd,
          },
        });

        // Add Base plan item
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            type: "SUBSCRIPTION",
            description: `Base subscription renewal for ${sub.plan.name} (${sub.price.interval})`,
            quantity: 1,
            unitAmount: baseAmount,
            amount: baseAmount,
            periodStart: sub.currentPeriodStart,
            periodEnd: sub.currentPeriodEnd,
          },
        });

        // Add Overage items
        for (const item of overageItems) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              type: "OVERAGE",
              description: item.description,
              quantity: item.quantity,
              unitAmount: item.unitAmount,
              amount: item.amount,
              featureId: item.featureId,
              periodStart: item.periodStart,
              periodEnd: item.periodEnd,
            },
          });
        }

        // Set Invoice Status to OPEN
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: "OPEN" },
        });

        // 4. Charge Authorization Card
        const defaultCard = sub.customer.paymentMethods[0];
        if (!defaultCard) {
          this.logger.warn(`No saved card details found for customer ${sub.customerId}. Initiating dunning...`);
          await this.initiateDunningSequence(tx, sub, invoice, "No card authorization code available.");
          return;
        }

        const paystackRef = `renewal_${invoice.id}`;

        const existingTx = await tx.transaction.findUnique({
          where: { paystackReference: paystackRef },
        });

        if (existingTx) {
          if (existingTx.status === "SUCCESS") {
            this.logger.log(`Transaction ${paystackRef} already succeeded. Skipping charge.`);
            return;
          }
          if (existingTx.status === "PENDING") {
            this.logger.warn(`Transaction ${paystackRef} is already PENDING. Skipping charge to avoid duplicate attempt.`);
            return;
          }
        }

        // Record a pending transaction record linked to this invoice
        await tx.transaction.create({
          data: {
            customerId: sub.customerId,
            invoiceId: invoice.id,
            status: "PENDING",
            amount: totalAmount,
            paystackReference: paystackRef,
          },
        });

        try {
          this.logger.log(`Initiating renewal charge request on Paystack for invoice ${invoice.id} (Ref: ${paystackRef})`);
          await this.subscriptionService.paystack.chargeAuthorization({
            email: sub.customer.user.email,
            amount: totalAmount,
            authorizationCode: defaultCard.paystackAuthorizationCode,
            reference: paystackRef,
            metadata: {
              invoiceId: invoice.id,
              subscriptionId: sub.id,
              type: "RENEWAL_CHARGE",
            },
          });
          this.logger.log(`Renewal charge authorization triggered successfully for invoice ${invoice.id} (Ref: ${paystackRef}). Awaiting webhook.`);
        } catch (chargeError: any) {
          this.logger.error(`Failed to submit renewal charge request to Paystack for invoice ${invoice.id}: ${chargeError.message}`);
        }
      });
    } catch (error: any) {
      this.logger.error(`Error processing renewal for subscription ${subscriptionId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async handleFinalOverageAndCancel(sub: any) {
    await this.prisma.$transaction(async (tx) => {
      const openSummaries = await tx.usageSummary.findMany({
        where: {
          subscriptionId: sub.id,
          status: UsagePeriodStatus.OPEN,
        },
        include: { feature: true },
      });

      const overageItems: any[] = [];
      for (const summary of openSummaries) {
        const pf = await tx.planFeature.findUnique({
          where: {
            planId_featureId: {
              planId: sub.planId,
              featureId: summary.featureId,
            },
          },
        });

        const limit = summary.includedLimit ?? 0;
        let overageUnits = 0;
        let overageAmount = 0;

        if (pf && pf.overageAllowed && summary.totalUsage > limit) {
          overageUnits = summary.totalUsage - limit;
          overageAmount = overageUnits * (pf.overageUnitPrice ?? 0);
        }

        await tx.usageSummary.update({
          where: { id: summary.id },
          data: {
            status: UsagePeriodStatus.CLOSED,
            closedAt: new Date(),
            overageUnits,
            overageAmount,
          },
        });

        if (overageAmount > 0) {
          overageItems.push({
            description: `Final overage charges for ${summary.feature.name}: ${overageUnits} used beyond limit`,
            quantity: overageUnits,
            unitAmount: pf.overageUnitPrice,
            amount: overageAmount,
            featureId: summary.featureId,
          });
        }

        const cacheKey = `usage:total:${sub.id}:${summary.feature.key}`;
        await this.redis.del(cacheKey);
      }

      const totalOverage = overageItems.reduce((acc, item) => acc + item.amount, 0);

      if (totalOverage > 0) {
        // Create an overage-only invoice
        const invoiceNumber = `INV-FIN-OVER-${Date.now()}`;
        const invoice = await tx.invoice.create({
          data: {
            customerId: sub.customerId,
            subscriptionId: sub.id,
            invoiceNumber,
            status: "OPEN",
            currency: sub.price.currency,
            subtotal: totalOverage,
            total: totalOverage,
            amountDue: totalOverage,
            dueDate: new Date(),
            periodStart: sub.currentPeriodStart,
            periodEnd: sub.currentPeriodEnd,
          },
        });

        for (const item of overageItems) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              type: "OVERAGE",
              description: item.description,
              quantity: item.quantity,
              unitAmount: item.unitAmount,
              amount: item.amount,
              featureId: item.featureId,
              periodStart: sub.currentPeriodStart,
              periodEnd: sub.currentPeriodEnd,
            },
          });
        }

        // Charge card immediately
        const defaultCard = sub.customer.paymentMethods[0];
        if (defaultCard) {
          const paystackRef = `sub_final_overage_${crypto.randomUUID().substring(0, 12)}`;
          await tx.transaction.create({
            data: {
              customerId: sub.customerId,
              invoiceId: invoice.id,
              status: "PENDING",
              amount: totalOverage,
              paystackReference: paystackRef,
            },
          });

          try {
            const paystackTx = await this.subscriptionService.paystack.chargeAuthorization({
              email: sub.customer.user.email,
              amount: totalOverage,
              authorizationCode: defaultCard.paystackAuthorizationCode,
              reference: paystackRef,
            });

            if (paystackTx.status === "success") {
              await tx.transaction.update({
                where: { paystackReference: paystackRef },
                data: { status: "SUCCESS", paidAt: new Date(paystackTx.paid_at || new Date()) },
              });

              await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                  status: "PAID",
                  amountPaid: totalOverage,
                  amountDue: 0,
                  paidAt: new Date(paystackTx.paid_at || new Date()),
                  paystackReference: paystackRef,
                },
              });
            } else {
              await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
            }
          } catch (e) {
            await tx.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
          }
        }
      }

      // Mark subscription as CANCELED
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.CANCELED, endedAt: new Date() },
      });

      // Audit change
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: sub.id,
          changeType: "CANCELLATION",
          fromPlanId: sub.planId,
          fromPriceId: sub.priceId,
          reason: "Period ended. Custom cancelled subscription completed.",
          initiatedBy: "system",
        },
      });
    });
  }

  private async initiateDunningSequence(tx: any, sub: any, invoice: any, failureReason: string) {
    // Transition subscription to PAST_DUE
    await tx.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.PAST_DUE },
    });

    // Mark invoice as OVERDUE
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "OVERDUE" },
    });

    // Schedule retry attempt 1
    const nextRetryDate = new Date();
    nextRetryDate.setDate(nextRetryDate.getDate() + 1); // retry 1 day later

    await tx.dunningAttempt.create({
      data: {
        invoiceId: invoice.id,
        attemptNumber: 1,
        status: "SCHEDULED",
        scheduledAt: nextRetryDate,
        failureReason,
      },
    });

    // Send email warning for dunning attempt 1
    await this.emailQueue.enqueueEmail({
      recipients: [sub.customer.user.email],
      subject: `Payment failed for your ${sub.plan.name} subscription renewal`,
      template: "dunning-warning",
      contextItems: {
        customerName: sub.customer.user.name,
        invoiceNumber: invoice.invoiceNumber,
        amountDue: (invoice.total / 100).toFixed(2),
        currency: invoice.currency,
        attemptNumber: 1,
        nextRetryDate: nextRetryDate.toLocaleDateString(),
      },
    });

    this.logger.log(`Initiated dunning sequence for subscription ${sub.id}, invoice ${invoice.id}. Attempt 1 scheduled for ${nextRetryDate}`);
  }

  private async handleExecuteDunningRetry(data: { dunningAttemptId: string }) {
    const { dunningAttemptId } = data;
    this.logger.log(`Executing dunning retry for attempt ${dunningAttemptId}`);

    const retry = await this.prisma.dunningAttempt.findUnique({
      where: { id: dunningAttemptId },
      include: {
        invoice: {
          include: {
            subscription: {
              include: {
                plan: true,
                price: true,
                customer: {
                  include: {
                    user: true,
                    paymentMethods: {
                      where: { isReusable: true, isDefault: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!retry || retry.status !== "SCHEDULED") {
      this.logger.warn(`Dunning retry ${dunningAttemptId} not found or not in SCHEDULED status.`);
      return;
    }

    const { invoice } = retry;
    const sub = invoice.subscription;
    if (!sub) {
      this.logger.error(`No subscription associated with invoice ${invoice.id}`);
      return;
    }

    const attemptNumber = retry.attemptNumber;
    const defaultCard = sub.customer.paymentMethods[0];

    // Mark current attempt as executed
    await this.prisma.dunningAttempt.update({
      where: { id: retry.id },
      data: { executedAt: new Date() },
    });

    if (!defaultCard) {
      await this.handleFailedDunningAttempt(retry, sub, invoice, attemptNumber, "No default card available.");
      return;
    }

    const paystackRef = `dunning_retry_${retry.id}`;

    const existingTx = await this.prisma.transaction.findUnique({
      where: { paystackReference: paystackRef },
    });

    if (existingTx) {
      if (existingTx.status === "SUCCESS") {
        this.logger.log(`Dunning transaction ${paystackRef} already succeeded. Skipping charge.`);
        return;
      }
      if (existingTx.status === "PENDING") {
        this.logger.warn(`Dunning transaction ${paystackRef} is already PENDING. Skipping charge to avoid duplicate attempt.`);
        return;
      }
    }

    // Create a transaction record
    await this.prisma.transaction.create({
      data: {
        customerId: sub.customerId,
        invoiceId: invoice.id,
        status: "PENDING",
        amount: invoice.total,
        paystackReference: paystackRef,
      },
    });

    try {
      this.logger.log(`Initiating dunning retry charge request on Paystack for invoice ${invoice.id} (Ref: ${paystackRef})`);
      await this.subscriptionService.paystack.chargeAuthorization({
        email: sub.customer.user.email,
        amount: invoice.total,
        authorizationCode: defaultCard.paystackAuthorizationCode,
        reference: paystackRef,
        metadata: {
          invoiceId: invoice.id,
          subscriptionId: sub.id,
          dunningAttemptId: retry.id,
          type: "DUNNING_RETRY",
        },
      });
      this.logger.log(`Dunning retry charge authorization triggered successfully for invoice ${invoice.id} (Ref: ${paystackRef}). Awaiting webhook.`);
    } catch (err: any) {
      this.logger.error(`Failed to execute dunning retry charge for invoice ${invoice.id}: ${err.message}`);
    }
  }

  private async handleFailedDunningAttempt(retry: any, sub: any, invoice: any, attemptNumber: number, failureReason: string) {
    this.logger.warn(`Dunning retry attempt ${attemptNumber} for subscription ${sub.id} failed: ${failureReason}`);

    // Update current dunning attempt to FAILED
    await this.prisma.dunningAttempt.update({
      where: { id: retry.id },
      data: { status: "FAILED" },
    });

    if (attemptNumber < 5) {
      // Schedule next attempt
      const nextAttemptNumber = attemptNumber + 1;
      const nextRetryDate = new Date();
      // Retries spaced: attempt 2: 1 day, attempt 3: 2 days, attempt 4: 2 days, attempt 5: 2 days (total 7 days grace)
      const delayDays = nextAttemptNumber === 2 ? 1 : 2;
      nextRetryDate.setDate(nextRetryDate.getDate() + delayDays);

      await this.prisma.dunningAttempt.create({
        data: {
          invoiceId: invoice.id,
          attemptNumber: nextAttemptNumber,
          status: "SCHEDULED",
          scheduledAt: nextRetryDate,
          failureReason,
        },
      });

      // Send email warning at each failed attempt
      await this.emailQueue.enqueueEmail({
        recipients: [sub.customer.user.email],
        subject: `Renewal Payment Failed - Attempt ${attemptNumber}/5`,
        template: "dunning-warning",
        contextItems: {
          customerName: sub.customer.user.name,
          invoiceNumber: invoice.invoiceNumber,
          amountDue: (invoice.total / 100).toFixed(2),
          currency: invoice.currency,
          attemptNumber,
          nextRetryDate: nextRetryDate.toLocaleDateString(),
        },
      });
    } else {
      // 5th failed attempt: Restrict/Cancel Subscription
      this.logger.error(`Dunning failed all 5 attempts for subscription ${sub.id}. Restricting account.`);

      // Check if Free Plan fallback is enabled
      const freePlanEnabled = await this.prisma.systemSetting.findUnique({
        where: { key: "FREE_PLAN_AUTO_SUBSCRIBE" },
      });

      const isFreeEnabled = freePlanEnabled ? freePlanEnabled.value === "true" : true;

      await this.prisma.$transaction(async (tx) => {
        // Mark Invoice as UNCOLLECTIBLE
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: "UNCOLLECTIBLE" },
        });

        if (isFreeEnabled) {
          const freePlan = await tx.plan.findUnique({
            where: { slug: "free" },
            include: { prices: true },
          });

          const freePrice = freePlan?.prices.find((p) => p.isActive);

          if (freePlan && freePrice) {
            await tx.subscription.update({
              where: { id: sub.id },
              data: {
                planId: freePlan.id,
                priceId: freePrice.id,
                status: SubscriptionStatus.ACTIVE,
                quantity: 1,
                currentPeriodStart: new Date(),
                currentPeriodEnd: computePeriodEnd(freePrice.interval),
                paystackSubscriptionCode: null,
                paystackEmailToken: null,
              },
            });

            await tx.subscriptionChange.create({
              data: {
                subscriptionId: sub.id,
                changeType: "DOWNGRADE",
                fromPlanId: sub.planId,
                fromPriceId: sub.priceId,
                toPlanId: freePlan.id,
                toPriceId: freePrice.id,
                toQuantity: 1,
                reason: "Auto-subscribed to Free tier fallback due to dunning payment failure.",
                initiatedBy: "system:dunning-failure",
              },
            });
          }
        } else {
          // No Free fallback: set status to CANCELED or RESTRICTED
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: SubscriptionStatus.RESTRICTED, endedAt: new Date() },
          });

          await tx.subscriptionChange.create({
            data: {
              subscriptionId: sub.id,
              changeType: "CANCELLATION",
              fromPlanId: sub.planId,
              fromPriceId: sub.priceId,
              reason: "Restricted subscription due to dunning payment failure.",
              initiatedBy: "system:dunning-failure",
            },
          });
        }
      });

      // Send final account restriction email
      await this.emailQueue.enqueueEmail({
        recipients: [sub.customer.user.email],
        subject: `Your subscription has been restricted due to non-payment`,
        template: "dunning-failed-restricted",
        contextItems: {
          customerName: sub.customer.user.name,
          invoiceNumber: invoice.invoiceNumber,
        },
      });
    }
  }
}
