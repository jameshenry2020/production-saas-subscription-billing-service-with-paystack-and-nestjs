import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { RedisService } from "../../../infrastructure/redis/redis.service";
import { EmailQueueService } from "../../../infrastructure/mails/email-queue.service";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { QUEUE_NAMES, JOB_NAMES } from "../../../infrastructure/queue/queue.constant";
import { UsageLimitExceededException } from "./exceptions/usage-limit-exceeded.exception";
import { SubscriptionStatus, UsagePeriodStatus } from "prisma/generated/prisma/client";

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly emailQueue: EmailQueueService,
    @InjectQueue(QUEUE_NAMES.BILLING) private readonly billingQueue: Queue
  ) {}

  /**
   * Wrapper to track usage using user ID.
   */
  async trackUsageByUserId(
    userId: string,
    featureKey: string,
    quantity: number,
    idempotencyKey?: string
  ): Promise<boolean> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });
    if (!customer) {
      throw new NotFoundException("Customer profile not found for this user.");
    }
    return this.trackUsage(customer.id, featureKey, quantity, idempotencyKey);
  }

  /**
   * Tracks usage for a feature.
   * Returns true if allowed (either within quota or via active overage), throws error otherwise.
   */
  async trackUsage(
    customerId: string,
    featureKey: string,
    quantity: number,
    idempotencyKey?: string
  ): Promise<boolean> {
    this.logger.log(`Tracking usage for customer ${customerId}, feature ${featureKey}, quantity ${quantity}`);

    // 1. Resolve customer active subscription
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        customerId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
      },
      include: {
        plan: {
          include: {
            planFeatures: {
              include: { feature: true },
            },
          },
        },
        customer: {
          include: { user: true },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException("No active subscription found for this customer.");
    }

    // 2. Find target feature in plan config
    const planFeature = subscription.plan.planFeatures.find(
      (pf) => pf.feature.key === featureKey
    );

    if (!planFeature) {
      throw new BadRequestException(`Feature ${featureKey} is not supported by your current plan.`);
    }

    const { limit, overageAllowed, overageUnitPrice, featureId, feature } = planFeature;

    // 3. If limit is null (unlimited), log and succeed
    if (limit === null) {
      await this.enqueueRecordUsageJob({
        subscriptionId: subscription.id,
        customerId,
        featureId,
        quantity,
        idempotencyKey,
      });
      return true;
    }

    // 4. Load or initialize usage total from Redis cache
    const cacheKey = `usage:total:${subscription.id}:${featureKey}`;
    let cachedTotal = await this.redis.get(cacheKey);
    let totalUsage = 0;

    const periodStart = subscription.currentPeriodStart;
    const periodEnd = subscription.currentPeriodEnd;
    const remainingMs = periodEnd.getTime() - Date.now();
    const remainingSecs = Math.max(1, Math.round(remainingMs / 1000));

    if (cachedTotal === null) {
      // Cache miss: Load from DB UsageSummary
      let summary = await this.prisma.usageSummary.findUnique({
        where: {
          subscriptionId_featureId_periodStart_periodEnd: {
            subscriptionId: subscription.id,
            featureId,
            periodStart,
            periodEnd,
          },
        },
      });

      if (!summary) {
        // First usage in this period: lazy init summary
        summary = await this.prisma.usageSummary.create({
          data: {
            subscriptionId: subscription.id,
            featureId,
            periodStart,
            periodEnd,
            totalUsage: 0,
            includedLimit: limit,
          },
        });
      }

      totalUsage = summary.totalUsage;
      await this.redis.set(cacheKey, totalUsage.toString(), remainingSecs);
    } else {
      totalUsage = parseInt(cachedTotal, 10);
    }

    const newTotalUsage = totalUsage + quantity;

    // 5. Evaluate threshold alerts (70% and 80%)
    await this.evaluateThresholdAlerts(subscription, featureKey, totalUsage, newTotalUsage, limit, remainingSecs);

    // 6. Evaluate quota limits
    if (newTotalUsage <= limit) {
      // Within quota
      await this.redis.incrBy(cacheKey, quantity);
      await this.enqueueRecordUsageJob({
        subscriptionId: subscription.id,
        customerId,
        featureId,
        quantity,
        idempotencyKey,
      });
      return true;
    }

    // Exceeded quota: check overage options
    if (!overageAllowed) {
      throw new UsageLimitExceededException({
        featureKey,
        limit,
        currentUsage: totalUsage,
        overageAllowed: false,
        overageUnitPrice: null,
        periodEnd,
      });
    }

    // Overage is allowed by plan. Is it activated by user?
    const overageSetting = await this.prisma.subscriptionOverageSetting.findUnique({
      where: {
        subscriptionId_featureId: {
          subscriptionId: subscription.id,
          featureId,
        },
      },
    });

    if (!overageSetting || !overageSetting.enabled) {
      // Overage is allowed but user has not activated it
      throw new UsageLimitExceededException({
        featureKey,
        limit,
        currentUsage: totalUsage,
        overageAllowed: true,
        overageUnitPrice,
        periodEnd,
      });
    }

    // Overage is activated: proceed with tracking overage usage
    await this.redis.incrBy(cacheKey, quantity);
    await this.enqueueRecordUsageJob({
      subscriptionId: subscription.id,
      customerId,
      featureId,
      quantity,
      idempotencyKey,
    });
    return true;
  }

  /**
   * Fetches current usage status for a feature.
   */
  async checkUsage(customerId: string, featureKey: string): Promise<any> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        customerId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
      },
      include: {
        plan: {
          include: {
            planFeatures: {
              include: { feature: true },
            },
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException("No active subscription found.");
    }

    const planFeature = subscription.plan.planFeatures.find(
      (pf) => pf.feature.key === featureKey
    );

    if (!planFeature) {
      throw new BadRequestException(`Feature ${featureKey} not supported by plan.`);
    }

    // Fetch total from DB or Redis
    const cacheKey = `usage:total:${subscription.id}:${featureKey}`;
    const cachedTotal = await this.redis.get(cacheKey);
    let totalUsage = 0;

    if (cachedTotal !== null) {
      totalUsage = parseInt(cachedTotal, 10);
    } else {
      const summary = await this.prisma.usageSummary.findUnique({
        where: {
          subscriptionId_featureId_periodStart_periodEnd: {
            subscriptionId: subscription.id,
            featureId: planFeature.featureId,
            periodStart: subscription.currentPeriodStart,
            periodEnd: subscription.currentPeriodEnd,
          },
        },
      });
      totalUsage = summary ? summary.totalUsage : 0;
    }

    const overageSetting = await this.prisma.subscriptionOverageSetting.findUnique({
      where: {
        subscriptionId_featureId: {
          subscriptionId: subscription.id,
          featureId: planFeature.featureId,
        },
      },
    });

    return {
      featureKey,
      limit: planFeature.limit,
      currentUsage: totalUsage,
      overageAllowed: planFeature.overageAllowed,
      overageUnitPrice: planFeature.overageUnitPrice,
      overageActivated: overageSetting ? overageSetting.enabled : false,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    };
  }

  /**
   * Activates or deactivates overage for a feature.
   */
  async toggleOverage(customerId: string, featureKey: string, enabled: boolean): Promise<any> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        customerId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
      },
      include: {
        plan: {
          include: {
            planFeatures: {
              include: { feature: true },
            },
          },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException("No active subscription found.");
    }

    const planFeature = subscription.plan.planFeatures.find(
      (pf) => pf.feature.key === featureKey
    );

    if (!planFeature) {
      throw new BadRequestException(`Feature ${featureKey} not supported by plan.`);
    }

    if (!planFeature.overageAllowed) {
      throw new BadRequestException("Overage billing is not allowed for this feature in your plan.");
    }

    const overage = await this.prisma.subscriptionOverageSetting.upsert({
      where: {
        subscriptionId_featureId: {
          subscriptionId: subscription.id,
          featureId: planFeature.featureId,
        },
      },
      create: {
        subscriptionId: subscription.id,
        featureId: planFeature.featureId,
        enabled,
      },
      update: {
        enabled,
      },
    });

    // Invalidate Redis total cache so next request checks DB/Settings afresh
    const cacheKey = `usage:total:${subscription.id}:${featureKey}`;
    await this.redis.del(cacheKey);

    return {
      success: true,
      featureKey,
      overageActivated: overage.enabled,
    };
  }

  /**
   * Roll over usage summaries for a subscription.
   * Closes out old open periods, calculates overages, creates new open summaries,
   * and returns items that should be invoiced.
   */
  async rolloverUsageSummaries(
    tx: any,
    subscriptionId: string,
    nextPeriodStart: Date,
    nextPeriodEnd: Date
  ): Promise<any[]> {
    this.logger.log(`Rolling over usage summaries for subscription ${subscriptionId}`);

    // Fetch open summaries for this subscription
    const openSummaries = await tx.usageSummary.findMany({
      where: {
        subscriptionId,
        status: UsagePeriodStatus.OPEN,
      },
      include: {
        feature: {
          include: {
            planFeatures: {
              where: {
                plan: {
                  subscriptions: { some: { id: subscriptionId } },
                },
              },
            },
          },
        },
      },
    });

    const invoiceItems: any[] = [];

    for (const summary of openSummaries) {
      const planFeature = summary.feature.planFeatures[0];
      const limit = summary.includedLimit ?? 0;
      const totalUsage = summary.totalUsage;

      let overageUnits = 0;
      let overageAmount = 0;

      if (planFeature && planFeature.overageAllowed && totalUsage > limit) {
        overageUnits = totalUsage - limit;
        overageAmount = overageUnits * (planFeature.overageUnitPrice ?? 0);
      }

      // Close current summary
      await tx.usageSummary.update({
        where: { id: summary.id },
        data: {
          status: UsagePeriodStatus.CLOSED,
          closedAt: new Date(),
          overageUnits,
          overageAmount,
        },
      });

      // If overage charges occurred, prepare an invoice item
      if (overageAmount > 0) {
        invoiceItems.push({
          type: "OVERAGE",
          description: `Overage charges for ${summary.feature.name}: ${overageUnits} ${summary.feature.unit || "units"} used beyond limit of ${limit}`,
          quantity: overageUnits,
          unitAmount: planFeature.overageUnitPrice,
          amount: overageAmount,
          featureId: summary.featureId,
          periodStart: summary.periodStart,
          periodEnd: summary.periodEnd,
        });
      }

      // Create new OPEN summary for the next period
      await tx.usageSummary.create({
        data: {
          subscriptionId,
          featureId: summary.featureId,
          periodStart: nextPeriodStart,
          periodEnd: nextPeriodEnd,
          totalUsage: 0,
          includedLimit: planFeature ? planFeature.limit : null,
          status: UsagePeriodStatus.OPEN,
        },
      });

      // Clear redis cache key
      const cacheKey = `usage:total:${subscriptionId}:${summary.feature.key}`;
      await this.redis.del(cacheKey);
    }

    return invoiceItems;
  }

  // --- PRIVATE UTILS ---

  private async enqueueRecordUsageJob(data: {
    subscriptionId: string;
    customerId: string;
    featureId: string;
    quantity: number;
    idempotencyKey?: string;
  }) {
    await this.billingQueue.add(JOB_NAMES.RECORD_USAGE, data);
  }

  private async evaluateThresholdAlerts(
    subscription: any,
    featureKey: string,
    totalUsage: number,
    newTotalUsage: number,
    limit: number,
    remainingSecs: number
  ) {
    if (limit <= 0) return;

    const prevPercent = (totalUsage / limit) * 100;
    const newPercent = (newTotalUsage / limit) * 100;

    const email = subscription.customer.user.email;
    const customerName = subscription.customer.user.name;

    const checkAndSend = async (threshold: number) => {
      const alertKey = `quota_alert_sent:${subscription.id}:${featureKey}:${threshold}`;
      const alreadySent = await this.redis.get(alertKey);

      if (!alreadySent) {
        await this.redis.set(alertKey, "true", remainingSecs);

        // Queue alert email
        await this.emailQueue.enqueueEmail({
          recipients: [email],
          subject: `Alert: You've used ${threshold}% of your ${featureKey} limit`,
          template: "quota-warning",
          contextItems: {
            customerName,
            featureKey,
            threshold,
            limit,
            currentUsage: newTotalUsage,
            activateOverageUrl: `https://enterprise-saas-billing.com/billing/subscription/usage/overage?feature=${featureKey}`,
          },
        });
        this.logger.log(`Threshold alert (${threshold}%) queued for ${email} on feature ${featureKey}`);
      }
    };

    if (prevPercent < 70 && newPercent >= 70) {
      await checkAndSend(70);
    } else if (prevPercent < 80 && newPercent >= 80) {
      await checkAndSend(80);
    }
  }
}
