import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { PaystackService } from "../paystack/paystack.service";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service";
import { SystemSettingService } from "../../../infrastructure/settings/system-setting.service";
import { CheckoutSubscriptionDto } from "../dto/checkout-subscription.dto";
import { SubscriptionResponseDto } from "../dto/subscription-response.dto";
import { SubscriptionMapper } from "../mapper/subscription.mapper";
import { SubscriptionStatus, SubscriptionChangeType, SubscriptionPaymentStatus, InvoiceItemType } from "prisma/generated/prisma/client";
import * as crypto from "crypto";
import { computePeriodEnd, getIntervalDays, calculateProration } from "../../../utils/billing-helper";

import { EmailQueueService } from "../../../infrastructure/mails/email-queue.service";
import { UsageService } from "../usage/usage.service";

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);


  constructor(
    private readonly prisma: PrismaService,
    public readonly paystack: PaystackService,
    private readonly idempotency: IdempotencyService,
    private readonly systemSetting: SystemSettingService,
    private readonly emailQueue: EmailQueueService,
    private readonly usageService: UsageService
  ) { }

  /**
   * Auto-subscribes a new user to the Free Plan on signup.
   * Handles creating the customer record internally and on Paystack synchronously.
   */
  async createCustomerAndSubscribeToFree(userId: string, email: string, name: string) {
    this.logger.log(`Onboarding user ${userId} to customer profile and Free Plan...`);

    let paystackCustomerId = `temp_paystack_${userId}_${crypto.randomUUID().substring(0, 8)}`;

    // 1. Sync Customer registry to Paystack
    try {
      const names = name.split(" ");
      const firstName = names[0] || name;
      const lastName = names.slice(1).join(" ") || undefined;
      const paystackCustomer = await this.paystack.createCustomer({
        email,
        firstName,
        lastName,
        metadata: { userId },
      });
      paystackCustomerId = paystackCustomer.customer_code;
      this.logger.log(`Created Paystack customer registry code: ${paystackCustomerId}`);
    } catch (error: any) {
      this.logger.warn(
        `Paystack customer registration failed for ${email}. Proceeding with temporary local registry. Error: ${error.message}`
      );
    }

    // 2. Fetch the Free Plan and its Price
    const freePlan = await this.prisma.plan.findUnique({
      where: { slug: "free" },
      include: { prices: true },
    });

    if (!freePlan) {
      throw new NotFoundException("Free billing plan not found in database. Run database seeds first.");
    }

    const freePrice = freePlan.prices.find((p) => p.isActive);
    if (!freePrice) {
      throw new NotFoundException("Active price for Free billing plan not found.");
    }

    // 3. Database transaction to create Customer and Subscription records
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          userId,
          paystackCustomerId,
        },
      });

      const subscription = await tx.subscription.create({
        data: {
          customerId: customer.id,
          planId: freePlan.id,
          priceId: freePrice.id,
          status: SubscriptionStatus.ACTIVE,
          quantity: 1,
          currentPeriodStart: new Date(),
          currentPeriodEnd: computePeriodEnd(freePrice.interval),
        },
        include: {
          plan: true,
          price: true,
        },
      });

      // Append to SubscriptionChange history log
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: subscription.id,
          changeType: SubscriptionChangeType.CREATED,
          toPlanId: freePlan.id,
          toPriceId: freePrice.id,
          toQuantity: 1,
          reason: "Auto-subscribed to Free tier at signup.",
          initiatedBy: "system:onboarding",
        },
      });

      this.logger.log(`Successfully auto-subscribed customer ${customer.id} to Free Plan.`);
      return customer;
    });
  }

  /**
   * Creates a Paystack customer and local Customer record WITHOUT creating a subscription.
   * Called at signup when FREE_PLAN_AUTO_SUBSCRIBE = false (trial mode is active).
   * The user will be offered a free trial on their first checkout attempt.
   */
  async createCustomerOnly(userId: string, email: string, name: string): Promise<void> {
    this.logger.log(`Creating customer profile only (trial mode) for user ${userId}...`);

    let paystackCustomerId = `temp_paystack_${userId}_${crypto.randomUUID().substring(0, 8)}`;

    try {
      const names = name.split(" ");
      const paystackCustomer = await this.paystack.createCustomer({
        email,
        firstName: names[0] || name,
        lastName: names.slice(1).join(" ") || undefined,
        metadata: { userId },
      });
      paystackCustomerId = paystackCustomer.customer_code;
    } catch (err: any) {
      this.logger.warn(`Paystack customer creation failed for ${email}. Using temp ID. Error: ${err.message}`);
    }

    await this.prisma.customer.create({
      data: { userId, paystackCustomerId },
    });

    this.logger.log(`Customer profile created for user ${userId} (no subscription — trial mode).`);
  }

  /**
   * Initializes a checkout session or plan upgrade/downgrade flow.
   */
  async initializeCheckout(userId: string, dto: CheckoutSubscriptionDto, idempotencyKey?: string): Promise<any> {
    const { priceId } = dto;
    const lockKey = idempotencyKey ? `checkout:${userId}:${priceId}:${idempotencyKey}` : null;

    // 1. Idempotency Key validation
    if (lockKey) {
      const cached = await this.idempotency.checkKey(lockKey);
      if (cached) {
        if (cached.isPending) {
          throw new ConflictException("A concurrent checkout request is already in progress.");
        }
        return cached.response?.body;
      }
      await this.idempotency.createLock(lockKey);
    }

    try {
      // 2. Fetch Customer profile
      const customer = await this.prisma.customer.findUnique({
        where: { userId },
        include: { user: true },
      });

      if (!customer) {
        throw new NotFoundException("Customer profile not found for this authenticated user.");
      }

      // Re-sync paystack customer if it is a placeholder
      if (customer.paystackCustomerId.startsWith("temp_paystack_")) {
        try {
          const names = customer.user.name.split(" ");
          const paystackCust = await this.paystack.createCustomer({
            email: customer.user.email,
            firstName: names[0],
            lastName: names.slice(1).join(" ") || undefined,
            metadata: { userId },
          });
          await this.prisma.customer.update({
            where: { id: customer.id },
            data: { paystackCustomerId: paystackCust.customer_code },
          });
          customer.paystackCustomerId = paystackCust.customer_code;
        } catch (err: any) {
          throw new BadRequestException(`Unable to initialize transaction checkout because Paystack customer sync failed: ${err.message}`);
        }
      }

      // 3. Resolve target Price and Plan
      const targetPrice = await this.prisma.price.findUnique({
        where: { id: priceId, isActive: true },
        include: { plan: { include: { prices: true } } },
      });

      if (!targetPrice) {
        throw new NotFoundException("Requested plan pricing option was not found or is inactive.");
      }

      // 4. Fetch existing active subscription
      let currentSub = await this.prisma.subscription.findFirst({
        where: {
          customerId: customer.id,
          status: {
            in: [
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.TRIALING,
              SubscriptionStatus.PAST_DUE,
              SubscriptionStatus.PAUSED,
            ],
          },
        },
        include: { plan: true, price: true },
      });

      // if there is no currentSub its mean two things: one no free plan active (trial mode), 2. the user is a new user
      if (!currentSub) {
        const freePlanEnabled = await this.systemSetting.getFlag("FREE_PLAN_AUTO_SUBSCRIBE", true);

        if (freePlanEnabled) {
          this.logger.log(`No active subscription record found for customer ${customer.id}. Seeding Free plan...`);
          const freePlan = await this.prisma.plan.findUnique({
            where: { slug: "free", isPublic: true },
            include: { prices: true },
          });

          if (!freePlan) {
            throw new NotFoundException("Free billing plan not found in database. Seed catalog first.");
          }

          const freePrice = freePlan.prices.find((p) => p.isActive);
          if (!freePrice) {
            throw new NotFoundException("Active price for Free billing plan not found.");
          }

          currentSub = await this.prisma.subscription.create({
            data: {
              customerId: customer.id,
              planId: freePlan.id,
              priceId: freePrice.id,
              status: SubscriptionStatus.ACTIVE,
              quantity: 1,
              currentPeriodStart: new Date(),
              currentPeriodEnd: computePeriodEnd(freePrice.interval),
            },
            include: { plan: true, price: true },
          });

          await this.prisma.subscriptionChange.create({
            data: {
              subscriptionId: currentSub.id,
              changeType: SubscriptionChangeType.CREATED,
              toPlanId: freePlan.id,
              toPriceId: freePrice.id,
              toQuantity: 1,
              reason: "Auto-created missing Free tier subscription (recovery fallback).",
              initiatedBy: "system:checkout-fallback",
            },
          });
        } else {
          // Free Plan is disabled: handle Free Trial if eligible
          if (targetPrice.trialPeriodDays && targetPrice.trialPeriodDays > 0 && !customer.hasUsedTrial) {
            const trialCheckoutRes = await this.initializeTrialCheckout(customer, targetPrice);
            if (lockKey) {
              await this.idempotency.resolveLock(lockKey, 201, trialCheckoutRes);
            }
            return trialCheckoutRes;
          }

          // If target is not eligible for trial, create or retrieve the INCOMPLETE subscription first (direct checkout)
          const existingIncomplete = await this.prisma.subscription.findFirst({
            where: {
              customerId: customer.id,
              status: SubscriptionStatus.INCOMPLETE,
            },
            include: { plan: true, price: true },
          });

          if (existingIncomplete) {
            this.logger.log(`Reusing existing INCOMPLETE subscription ${existingIncomplete.id} for customer ${customer.id} (direct checkout)`);
            currentSub = await this.prisma.subscription.update({
              where: { id: existingIncomplete.id },
              data: {
                planId: targetPrice.planId,
                priceId: targetPrice.id,
                currentPeriodStart: new Date(),
                currentPeriodEnd: computePeriodEnd(targetPrice.interval),
              },
              include: { plan: true, price: true },
            });

            await this.prisma.subscriptionChange.create({
              data: {
                subscriptionId: currentSub.id,
                changeType: SubscriptionChangeType.CREATED,
                toPlanId: targetPrice.planId,
                toPriceId: targetPrice.id,
                toQuantity: 1,
                reason: "Updated incomplete subscription for direct checkout (retry/plan change).",
                initiatedBy: "customer",
              },
            });
          } else {
            this.logger.log(`Creating new INCOMPLETE subscription for customer ${customer.id} on price ${targetPrice.id} (direct checkout)`);
            currentSub = await this.prisma.subscription.create({
              data: {
                customerId: customer.id,
                planId: targetPrice.planId,
                priceId: targetPrice.id,
                status: SubscriptionStatus.INCOMPLETE,
                quantity: 1,
                currentPeriodStart: new Date(),
                currentPeriodEnd: computePeriodEnd(targetPrice.interval),
              },
              include: { plan: true, price: true },
            });

            await this.prisma.subscriptionChange.create({
              data: {
                subscriptionId: currentSub.id,
                changeType: SubscriptionChangeType.CREATED,
                toPlanId: targetPrice.planId,
                toPriceId: targetPrice.id,
                toQuantity: 1,
                reason: "Created incomplete subscription for direct checkout.",
                initiatedBy: "customer",
              },
            });
          }
        }
      }

      let response: any;

      // 5. Determine transition flow
      if (currentSub && currentSub.planId === targetPrice.planId && currentSub.priceId === targetPrice.id && currentSub.status !== SubscriptionStatus.INCOMPLETE) {
        throw new BadRequestException("You are already subscribed to this billing plan option.");
      }

      if (currentSub && currentSub.status === SubscriptionStatus.INCOMPLETE) {
        // Direct checkout for new user
        response = await this.handleDirectSubscription(customer, currentSub, targetPrice);
      } else if (currentSub && currentSub.plan.slug === "free") {
        // Upgrade from Free Plan to Paid
        response = await this.handleFreeToPaidUpgrade(customer, currentSub, targetPrice);
      } else {
        // Paid Plan -> Paid Plan Upgrade, Downgrade, or Commitment switch
        response = await this.handlePaidToPaidChange(customer, currentSub, targetPrice);
      }

      // Resolve idempotency lock
      if (lockKey) {
        await this.idempotency.resolveLock(lockKey, 201, response);
      }

      return response;
    } catch (error) {
      if (lockKey) {
        await this.idempotency.releaseLock(lockKey);
      }
      throw error;
    }
  }

  /**
   * Flow 1b: Direct Paid Subscription Checkout
   * Handles checkouts for new users who are immediately subscribing to a paid plan without a trial.
   */
  private async handleDirectSubscription(customer: any, currentSub: any, targetPrice: any): Promise<any> {
    const reference = `sub_checkout_direct_${crypto.randomUUID().substring(0, 12)}`;

    // 1. Initialize Paystack transaction first (outside DB transaction)
    let paystackTx: any;
    try {
      paystackTx = await this.paystack.initializeTransaction({
        email: customer.user.email,
        amount: targetPrice.amount,
        reference,
        metadata: {
          customerId: customer.id,
          subscriptionId: currentSub.id,
          type: "DIRECT_SUBSCRIPTION",
          targetPlanId: targetPrice.planId,
          targetPriceId: targetPrice.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to initialize Paystack direct checkout transaction: ${err.message}`);
      throw new BadRequestException(`Paystack initialization failed: ${err.message}`);
    }

    // 2. Persist pending objects in DB (inside transactional block)
    const checkoutResult = await this.createPendingCheckoutRecords({
      customer,
      subscription: currentSub,
      targetPrice,
      amount: targetPrice.amount,
      reference,
      invoicePrefix: "INV-DIRECT",
      invoiceItemType: InvoiceItemType.SUBSCRIPTION,
      invoiceItemDescription: `Direct subscription to ${targetPrice.plan.name} (${targetPrice.interval})`,
      periodStart: new Date(),
      periodEnd: computePeriodEnd(targetPrice.interval),
    });

    return {
      status: "PENDING_PAYMENT",
      paystackReference: reference,
      authorizationUrl: paystackTx.authorization_url,
    };
  }

  /**
   * Flow 1: Free to Paid Plan (Initial Upgrade)
   * Checks trial eligibility first. If eligible, starts the card-verification trial flow.
   * Otherwise, initializes a standard Paystack checkout transaction.
   */
  private async handleFreeToPaidUpgrade(customer: any, currentSub: any | null, targetPrice: any): Promise<any> {

    const reference = `sub_checkout_${crypto.randomUUID().substring(0, 12)}`;

    // 1. Initialize Paystack transaction first (outside DB transaction)
    let paystackTx: any;
    try {
      paystackTx = await this.paystack.initializeTransaction({
        email: customer.user.email,
        amount: targetPrice.amount,
        reference,
        metadata: {
          customerId: customer.id,
          subscriptionId: currentSub.id,
          type: "INITIAL_UPGRADE",
          targetPlanId: targetPrice.planId,
          targetPriceId: targetPrice.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to initialize Paystack checkout transaction: ${err.message}`);
      throw new BadRequestException(`Paystack initialization failed: ${err.message}`);
    }

    // 2. Persist pending objects in DB (inside transactional block)
    const checkoutResult = await this.createPendingCheckoutRecords({
      customer,
      subscription: currentSub,
      targetPrice,
      amount: targetPrice.amount,
      reference,
      invoicePrefix: "INV-UPG",
      invoiceItemType: InvoiceItemType.SUBSCRIPTION,
      invoiceItemDescription: `Upgrade to ${targetPrice.plan.name} (${targetPrice.interval})`,
      periodStart: new Date(),
      periodEnd: computePeriodEnd(targetPrice.interval),
    });

    return {
      status: "PENDING_PAYMENT",
      paystackReference: reference,
      authorizationUrl: paystackTx.authorization_url,
    };
  }

  /**
   * Flow 4: Card authentication checkout for Free Trials.
   * Charges a small refundable card verification fee (50 NGN) to capture reusable card authorization.
   */
  private async initializeTrialCheckout(customer: any, targetPrice: any): Promise<any> {
    const CARD_VERIFICATION_AMOUNT = 50; // 50 NGN refundable card verification fee
    const reference = `trial_verify_${customer.id}_${crypto.randomUUID().substring(0, 12)}`;

    // 1. Pre-create or retrieve the local subscription in INCOMPLETE status so we have a subscription ID
    const trialStart = new Date();
    const trialEnd = new Date(trialStart.getTime() + targetPrice.trialPeriodDays * 24 * 60 * 60 * 1000);

    const existingIncomplete = await this.prisma.subscription.findFirst({
      where: {
        customerId: customer.id,
        status: SubscriptionStatus.INCOMPLETE,
      },
    });

    let incompleteSub;
    if (existingIncomplete) {
      this.logger.log(`Reusing existing INCOMPLETE subscription ${existingIncomplete.id} for customer ${customer.id} on price ${targetPrice.id}`);
      incompleteSub = await this.prisma.subscription.update({
        where: { id: existingIncomplete.id },
        data: {
          planId: targetPrice.planId,
          priceId: targetPrice.id,
          currentPeriodStart: trialStart,
          currentPeriodEnd: trialEnd,
        },
      });

      await this.prisma.subscriptionChange.create({
        data: {
          subscriptionId: incompleteSub.id,
          changeType: SubscriptionChangeType.CREATED,
          toPlanId: targetPrice.planId,
          toPriceId: targetPrice.id,
          toQuantity: 1,
          reason: `Updated incomplete subscription for free trial (${targetPrice.trialPeriodDays} days) (checkout retry).`,
          initiatedBy: "customer",
        },
      });
    } else {
      incompleteSub = await this.prisma.subscription.create({
        data: {
          customerId: customer.id,
          planId: targetPrice.planId,
          priceId: targetPrice.id,
          status: SubscriptionStatus.INCOMPLETE,
          quantity: 1,
          currentPeriodStart: trialStart,
          currentPeriodEnd: trialEnd,
        },
      });

      await this.prisma.subscriptionChange.create({
        data: {
          subscriptionId: incompleteSub.id,
          changeType: SubscriptionChangeType.CREATED,
          toPlanId: targetPrice.planId,
          toPriceId: targetPrice.id,
          toQuantity: 1,
          reason: `Created incomplete subscription for free trial (${targetPrice.trialPeriodDays} days).`,
          initiatedBy: "customer",
        },
      });
    }

    // 2. Initialize Paystack transaction
    let paystackTx: any;
    try {
      paystackTx = await this.paystack.initializeTransaction({
        email: customer.user.email,
        amount: CARD_VERIFICATION_AMOUNT,
        reference,
        metadata: {
          customerId: customer.id,
          subscriptionId: incompleteSub.id,
          type: "TRIAL_VERIFICATION",
          targetPlanId: targetPrice.planId,
          targetPriceId: targetPrice.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to initialize Paystack trial verification transaction: ${err.message}`);
      throw new BadRequestException(`Paystack initialization failed: ${err.message}`);
    }

    // Persist pending Transaction record
    await this.prisma.transaction.create({
      data: {
        customerId: customer.id,
        status: "PENDING",
        amount: CARD_VERIFICATION_AMOUNT,
        paystackReference: reference,
      },
    });

    this.logger.log(`Initialized trial card verification checkout for customer ${customer.id} on price ${targetPrice.id}`);

    return {
      status: "TRIAL_CHECKOUT_INITIALIZED",
      authorization_url: paystackTx.authorization_url,
      reference,
    };
  }

  /**
   * Helper to manually fall back to a paystack checkout redirect if direct charge fails.
   */
  private async initializeManualCheckoutForProration(
    customer: any,
    currentSub: any,
    targetPrice: any,
    prorationAmount: number
  ): Promise<any> {
    const reference = `sub_checkout_prorated_${crypto.randomUUID().substring(0, 12)}`;

    // 1. Initialize Paystack transaction first (outside DB transaction)
    let paystackTx: any;
    try {
      paystackTx = await this.paystack.initializeTransaction({
        email: customer.user.email,
        amount: prorationAmount,
        reference,
        metadata: {
          customerId: customer.id,
          subscriptionId: currentSub.id,
          type: "PLAN_CHANGE_UPGRADE",
          targetPlanId: targetPrice.planId,
          targetPriceId: targetPrice.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to initialize Paystack checkout for proration: ${err.message}`);
      throw new BadRequestException(`Paystack initialization failed: ${err.message}`);
    }

    // 2. Persist pending objects in DB (inside transactional block)
    const checkoutResult = await this.createPendingCheckoutRecords({
      customer,
      subscription: currentSub,
      targetPrice,
      amount: prorationAmount,
      reference,
      invoicePrefix: "INV-PRORATED",
      invoiceItemType: InvoiceItemType.PRORATION,
      invoiceItemDescription: `Upgrade proration: ${currentSub.plan.name} -> ${targetPrice.plan.name}`,
      periodStart: new Date(),
      periodEnd: currentSub.currentPeriodEnd,
    });

    return {
      status: "PENDING_PAYMENT",
      paystackReference: reference,
      authorizationUrl: paystackTx.authorization_url,
    };
  }

  /**
   * Flow 2: Paid to Paid Plan (Prorated Upgrade or Scheduled Downgrade)
   */
  private async handlePaidToPaidChange(customer: any, currentSub: any, targetPrice: any): Promise<any> {
    const defaultPm = await this.prisma.paymentMethod.findFirst({
      where: { customerId: customer.id, isReusable: true, isDefault: true },
    });

    // 1. Classify the transition type (Upgrade or Downgrade)
    let isUpgrade = false;
    if (targetPrice.plan.sortOrder > currentSub.plan.sortOrder) {
      isUpgrade = true;
    } else if (targetPrice.plan.id === currentSub.plan.id) {
      // Same plan, check interval changes
      if (currentSub.price.interval === "MONTHLY" && targetPrice.interval === "ANNUALLY") {
        isUpgrade = true; // Monthly to Annually upgrade of commitment
      }
    }

    // 2. Handle Downgrade/Commitment Switch (Annual -> Monthly or lower plan tier)
    if (!isUpgrade) {
      return this.handleDowngrade(customer, currentSub, targetPrice, defaultPm);
    }

    // 3. Handle Upgrade: compute proration using helper utility
    const now = new Date();
    const cycleStart = currentSub.currentPeriodStart;
    const cycleEnd = currentSub.currentPeriodEnd;
    const totalCycleMs = cycleEnd.getTime() - cycleStart.getTime();
    const remainingMs = cycleEnd.getTime() - now.getTime();

    const prorationAmount = calculateProration({
      currentPriceAmount: currentSub.price.amount,
      currentInterval: currentSub.price.interval,
      targetPriceAmount: targetPrice.amount,
      targetInterval: targetPrice.interval,
      remainingMs,
      totalCycleMs,
    });

    if (prorationAmount <= 0) {
      // Fallback: if calculated proration is non-positive, treat as scheduled downgrade/neutral swap
      return this.handleDowngrade(customer, currentSub, targetPrice, defaultPm);
    }

    // 4. Stored card unavailable -> delegate to manual payment checkout session directly
    if (!defaultPm) {
      this.logger.log("Stored card unavailable. Forwarding to manual proration checkout page...");
      return this.initializeManualCheckoutForProration(customer, currentSub, targetPrice, prorationAmount);
    }

    // 5. Upgrade with active default payment card -> Charge card immediately
    const reference = `sub_upgrade_${crypto.randomUUID().substring(0, 12)}`;

    // Pre-create pending database items inside transaction
    const checkoutResult = await this.createPendingCheckoutRecords({
      customer,
      subscription: currentSub,
      targetPrice,
      amount: prorationAmount,
      reference,
      invoicePrefix: "INV-PRORATED",
      invoiceItemType: InvoiceItemType.PRORATION,
      invoiceItemDescription: `Upgrade proration: ${currentSub.plan.name} -> ${targetPrice.plan.name}`,
      periodStart: now,
      periodEnd: cycleEnd,
    });

    this.logger.log(
      `Attempting immediate charge for upgrade proration: ${prorationAmount} NGN on card ${defaultPm.last4}`
    );

    try {
      const chargeTx = await this.paystack.chargeAuthorization({
        email: customer.user.email,
        amount: prorationAmount,
        authorizationCode: defaultPm.paystackAuthorizationCode,
        reference,
        metadata: {
          customerId: customer.id,
          subscriptionId: currentSub.id,
          type: "PLAN_CHANGE_UPGRADE",
          targetPlanId: targetPrice.planId,
          targetPriceId: targetPrice.id,
        },
      });

      if (chargeTx.status === "success") {
        this.logger.log(`Direct card charge executed successfully (Ref: ${reference}). Awaiting webhook.`);
        return {
          status: "PENDING_PAYMENT",
          paystackReference: reference,
        };
      } else {
        // Explicit card decline -> mark DB records FAILED
        await this.prisma.$transaction(async (tx) => {
          await tx.subscriptionPayment.update({
            where: { id: checkoutResult.subPayment.id },
            data: { status: SubscriptionPaymentStatus.FAILED },
          });
          await tx.transaction.update({
            where: { paystackReference: reference },
            data: { status: "FAILED" },
          });
        });
        throw new BadRequestException(`Charge declined: ${chargeTx.gateway_response || 'Unknown reason'}`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed direct charge of stored card during upgrade: ${err.message}. Routing to manual checkout screen.`);
      // Mark first attempt failed
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionPayment.update({
          where: { id: checkoutResult.subPayment.id },
          data: { status: SubscriptionPaymentStatus.FAILED },
        });
        await tx.transaction.update({
          where: { paystackReference: reference },
          data: { status: "FAILED" },
        });
      }).catch(() => { });
      // Fallback to manual checkout route
      return this.initializeManualCheckoutForProration(customer, currentSub, targetPrice, prorationAmount);
    }
  }

  /**
   * Flow 3: Handle Downgrade / commitment Reduction
   * Schedules plan change on Paystack for currentPeriodEnd.
   * Locally updates only the Paystack codes on current subscription and logs a future-dated SubscriptionChange.
   */
  private async handleDowngrade(customer: any, currentSub: any, targetPrice: any, defaultPm: any): Promise<any> {
    this.logger.log(`Scheduling downgrade from ${currentSub.plan.name} to ${targetPrice.plan.name} at ${currentSub.currentPeriodEnd}`);

    const updatedSub = await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: currentSub.id,
          changeType: SubscriptionChangeType.DOWNGRADE,
          fromPlanId: currentSub.planId,
          toPlanId: targetPrice.planId,
          fromPriceId: currentSub.priceId,
          toPriceId: targetPrice.id,
          prorationAmount: 0,
          effectiveAt: currentSub.currentPeriodEnd,
          reason: `Downgrade scheduled from ${currentSub.plan.name} to ${targetPrice.plan.name} to take effect at next cycle.`,
          initiatedBy: "customer",
        },
      });

      return currentSub;
    });

    return SubscriptionMapper.toSubscriptionResponse(updatedSub);
  }

  /**
   * Unified Method to confirm and process successful payments, transition subscription details,
   * write logs, and update transaction/invoice details. Supports checkouts and renewals.
   */
  async processSuccessfulPayment(reference: string, paystackData: any): Promise<any> {
    this.logger.log(`Processing successful payment for reference: ${reference}`);

    // ── Trial Payment Discriminators ───────────────────────────────────────────────
    // Check metadata.type before standard payment lookup. Trial payments use special handlers
    // and are not linked to a SubscriptionPayment record in the normal way.
    const chargeMetadata = paystackData?.metadata;
    if (chargeMetadata?.type === "TRIAL_VERIFICATION") {
      return this.handleTrialVerificationSuccess(reference, paystackData, chargeMetadata);
    }
    if (chargeMetadata?.type === "CARD_UPDATE") {
      return this.handleCardUpdateSuccess(reference, paystackData, chargeMetadata);
    }
    // ───────────────────────────────────────────────────────────────────────────

    // Fetch the pending payment record
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { paystackReference: reference },
    });

    // 1. If no SubscriptionPayment is found, check if this is a custom renewal, dunning charge, or legacy subscription
    if (!payment) {
      if (chargeMetadata?.type === "RENEWAL_CHARGE") {
        return this.handleRenewalSuccess(reference, paystackData, chargeMetadata);
      }
      if (chargeMetadata?.type === "DUNNING_RETRY") {
        return this.handleDunningRetrySuccess(reference, paystackData, chargeMetadata);
      }

      const subCode = paystackData.subscription?.subscription_code;
      if (!subCode) {
        throw new NotFoundException(`No pending payment, renewal metadata, or subscription found for reference: ${reference}`);
      }

      this.logger.log(`Handling legacy renewal/scheduled plan transition for Paystack code: ${subCode}`);
      const currentSub = await this.prisma.subscription.findUnique({
        where: { paystackSubscriptionCode: subCode },
        include: { plan: true, price: true },
      });

      if (!currentSub) {
        throw new NotFoundException(`Local subscription not found for Paystack code: ${subCode}`);
      }

      const planCode = paystackData.plan?.plan_code;
      const targetPrice = planCode
        ? await this.prisma.price.findUnique({
          where: { paystackPlanCode: planCode },
          include: { plan: true },
        })
        : null;

      const activePrice = targetPrice || currentSub.price;
      const activePlan = targetPrice?.plan || currentSub.plan;

      return this.prisma.$transaction(async (tx) => {
        // Create Transaction & Invoice record if they don't already exist for this reference
        const existingTx = await tx.transaction.findUnique({
          where: { paystackReference: reference },
        });

        const paidDate = paystackData.paid_at ? new Date(paystackData.paid_at) : new Date();

        if (!existingTx) {
          // Check if there is an existing OPEN or DRAFT invoice for this subscription renewal cycle
          let invoice = await tx.invoice.findFirst({
            where: {
              subscriptionId: currentSub.id,
              status: { in: ["OPEN", "DRAFT"] },
            },
            orderBy: { createdAt: "desc" },
          });

          if (invoice) {
            // Update the existing invoice to PAID
            invoice = await tx.invoice.update({
              where: { id: invoice.id },
              data: {
                status: "PAID",
                amountPaid: paystackData.amount,
                amountDue: 0,
                paidAt: paidDate,
                paystackReference: reference,
              },
            });
          } else {
            // Fallback: create a new invoice if not pre-created by webhook
            const invoiceNumber = `INV-RENEW-${Date.now()}`;
            invoice = await tx.invoice.create({
              data: {
                customerId: currentSub.customerId,
                subscriptionId: currentSub.id,
                invoiceNumber,
                status: "PAID",
                currency: activePrice.currency,
                subtotal: paystackData.amount,
                total: paystackData.amount,
                amountPaid: paystackData.amount,
                amountDue: 0,
                paidAt: paidDate,
                paystackReference: reference,
              },
            });

            await tx.invoiceItem.create({
              data: {
                invoiceId: invoice.id,
                type: "SUBSCRIPTION",
                description: `Renewal charge for ${activePlan.name} (${activePrice.interval})`,
                quantity: 1,
                unitAmount: paystackData.amount,
                amount: paystackData.amount,
                periodStart: paidDate,
                periodEnd: computePeriodEnd(activePrice.interval, paidDate),
              },
            });
          }

          // Record transaction record linked to this invoice
          await tx.transaction.create({
            data: {
              customerId: currentSub.customerId,
              invoiceId: invoice.id,
              status: "SUCCESS",
              amount: paystackData.amount,
              paystackReference: reference,
              channel: paystackData.channel || null,
              paidAt: paidDate,
            },
          });
        }

        const newPeriodEnd = computePeriodEnd(activePrice.interval, paidDate);

        // Update active subscription plan and dates
        const sub = await tx.subscription.update({
          where: { id: currentSub.id },
          data: {
            planId: activePlan.id,
            priceId: activePrice.id,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: paidDate,
            currentPeriodEnd: newPeriodEnd,
          },
          include: { plan: true, price: true },
        });

        // Audit the change if the plan/price configuration updated OR if they were trialing and are now active (trial conversion)
        const wasTrialing = currentSub.status === SubscriptionStatus.TRIALING;
        if (currentSub.priceId !== activePrice.id || wasTrialing) {
          let changeType: SubscriptionChangeType = SubscriptionChangeType.PLAN_CHANGE;
          let reason = `Scheduled plan switch successfully executed on renewal reference (${reference}).`;

          if (wasTrialing) {
            changeType = SubscriptionChangeType.PLAN_CHANGE;
            reason = `Free trial converted to active subscription on billing date (Ref: ${reference}).`;
          } else if (activePlan.sortOrder > currentSub.plan.sortOrder) {
            changeType = SubscriptionChangeType.UPGRADE;
          } else if (activePlan.sortOrder < currentSub.plan.sortOrder) {
            changeType = SubscriptionChangeType.DOWNGRADE;
          }

          await tx.subscriptionChange.create({
            data: {
              subscriptionId: currentSub.id,
              changeType,
              fromPlanId: currentSub.planId,
              toPlanId: activePlan.id,
              fromPriceId: currentSub.priceId,
              toPriceId: activePrice.id,
              fromPaystackSubCode: currentSub.paystackSubscriptionCode,
              toPaystackSubCode: currentSub.paystackSubscriptionCode,
              prorationAmount: 0,
              reason,
              initiatedBy: "system",
            },
          });
        }

        return sub;
      });
    }

    // 2. Handle standard checkout redirect confirmation
    if (payment.status === SubscriptionPaymentStatus.SUCCESS) {
      this.logger.log(`Payment reference ${reference} already processed as SUCCESS.`);
      return this.prisma.subscription.findUnique({
        where: { id: payment.subscriptionId },
        include: { plan: true, price: true },
      });
    }

    const targetPrice = await this.prisma.price.findUnique({
      where: { id: payment.targetPriceId },
      include: { plan: true },
    });

    if (!targetPrice) {
      throw new NotFoundException(`Target plan price not found for payment: ${payment.targetPriceId}`);
    }

    const currentSub = await this.prisma.subscription.findUnique({
      where: { id: payment.subscriptionId },
      include: { plan: true, price: true },
    });

    if (!currentSub) {
      throw new NotFoundException(`Subscription not found for payment: ${payment.subscriptionId}`);
    }

    // Determine upgrade / downgrade classification for change logs
    let changeType: SubscriptionChangeType = SubscriptionChangeType.UPGRADE;
    let reason = `Plan transition successfully completed via payment authorization (${reference}).`;

    if (currentSub.status === SubscriptionStatus.INCOMPLETE) {
      changeType = SubscriptionChangeType.CREATED;
      reason = `Direct paid subscription successfully completed via payment authorization (${reference}).`;
    } else if (currentSub.plan.slug === "free") {
      changeType = SubscriptionChangeType.UPGRADE;
      reason = `Plan transition from Free to ${targetPrice.plan.name} successfully completed via payment authorization (${reference}).`;
    } else {
      if (targetPrice.plan.sortOrder > currentSub.plan.sortOrder) {
        changeType = SubscriptionChangeType.UPGRADE;
      } else if (targetPrice.plan.sortOrder < currentSub.plan.sortOrder) {
        changeType = SubscriptionChangeType.DOWNGRADE;
      } else {
        if (currentSub.price.interval === "MONTHLY" && targetPrice.interval === "ANNUALLY") {
          changeType = SubscriptionChangeType.UPGRADE;
        } else if (currentSub.price.interval === "ANNUALLY" && targetPrice.interval === "MONTHLY") {
          changeType = SubscriptionChangeType.DOWNGRADE;
        } else {
          changeType = SubscriptionChangeType.PLAN_CHANGE;
        }
      }
    }

    // Resolve paystack subscription details if provided
    let paystackSubCode = paystackData.subscription?.subscription_code || currentSub.paystackSubscriptionCode;
    let paystackEmailToken = paystackData.subscription?.email_token || currentSub.paystackEmailToken;

    const paidDate = paystackData.paid_at ? new Date(paystackData.paid_at) : new Date();
    const newPeriodEnd = computePeriodEnd(targetPrice.interval, paidDate);

    // Backend-managed subscriptions do not sync upgrades on Paystack.

    return this.prisma.$transaction(async (tx) => {
      // Update SubscriptionPayment status
      await tx.subscriptionPayment.update({
        where: { id: payment.id },
        data: { status: SubscriptionPaymentStatus.SUCCESS },
      });

      // Update Transaction status
      await tx.transaction.updateMany({
        where: { paystackReference: reference },
        data: {
          status: "SUCCESS",
          channel: paystackData.channel || null,
          paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
        },
      });

      // Update Invoice status
      const transactionRecord = await tx.transaction.findFirst({
        where: { paystackReference: reference },
      });
      if (transactionRecord && transactionRecord.invoiceId) {
        await tx.invoice.update({
          where: { id: transactionRecord.invoiceId },
          data: {
            status: "PAID",
            amountPaid: paystackData.amount,
            amountDue: 0,
            paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
          },
        });
      }

      // Update Stored Card Authorization
      if (paystackData.authorization?.reusable) {
        const auth = paystackData.authorization;
        // Reset defaults
        await tx.paymentMethod.updateMany({
          where: { customerId: currentSub.customerId },
          data: { isDefault: false },
        });

        await tx.paymentMethod.upsert({
          where: { paystackAuthorizationCode: auth.authorization_code },
          update: { isDefault: true },
          create: {
            customerId: currentSub.customerId,
            paystackAuthorizationCode: auth.authorization_code,
            cardType: auth.card_type,
            bank: auth.bank,
            last4: auth.last4,
            expMonth: auth.exp_month,
            expYear: auth.exp_year,
            isReusable: true,
            isDefault: true,
          },
        });
      }

      // Update active subscription
      const sub = await tx.subscription.update({
        where: { id: currentSub.id },
        data: {
          planId: targetPrice.planId,
          priceId: targetPrice.id,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: paidDate,
          currentPeriodEnd: newPeriodEnd,
        },
        include: { plan: true, price: true },
      });

      // Record detailed change history
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: currentSub.id,
          changeType,
          fromPlanId: currentSub.planId,
          toPlanId: targetPrice.planId,
          fromPriceId: currentSub.priceId,
          toPriceId: targetPrice.id,
          fromPaystackSubCode: currentSub.paystackSubscriptionCode,
          toPaystackSubCode: paystackSubCode,
          fromPaystackEmailToken: currentSub.paystackEmailToken,
          toPaystackEmailToken: paystackEmailToken,
          prorationAmount: payment.amount,
          reason,
          initiatedBy: "customer",
        },
      });

      return sub;
    });
  }

  /**
   * Verifies a checkout session reference manually. Used as a backup or callback sync.
   */
  async verifyAndSyncPayment(userId: string, reference: string): Promise<SubscriptionResponseDto> {
    this.logger.log(`Verifying payment reference: ${reference} for user ${userId}`);

    // Verify User Ownership
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    const transaction = await this.prisma.transaction.findUnique({
      where: { paystackReference: reference },
      include: { invoice: { include: { subscription: true } } },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with reference "${reference}" not found.`);
    }

    if (!customer || transaction.customerId !== customer.id) {
      throw new ForbiddenException("You do not have access to this transaction.");
    }

    // If transaction already succeeded locally
    if (transaction.status === "SUCCESS" && transaction.invoice?.subscription) {
      return SubscriptionMapper.toSubscriptionResponse(
        await this.prisma.subscription.findUnique({
          where: { id: transaction.invoice.subscriptionId as string },
          include: { plan: true, price: true },
        })
      );
    }

    // Call Paystack API to verify
    const paystackTx = await this.paystack.verifyTransaction(reference);

    if (paystackTx.status !== "success") {
      throw new BadRequestException(`Payment was not successful. Status: ${paystackTx.status}`);
    }

    const updatedSub = await this.processSuccessfulPayment(reference, paystackTx);
    return SubscriptionMapper.toSubscriptionResponse(updatedSub);
  }

  /**
   * Confirms successful card verification charge for free trials.
   * Caches the customer's payment method card, auto-refunds the verification fee,
   * registers the subscription on Paystack with startDate = trialEnd,
   * and transitions the local subscription to TRIALING status.
   */
  private async handleTrialVerificationSuccess(reference: string, paystackData: any, chargeMetadata: any): Promise<any> {
    const { customerId, targetPriceId, targetPlanId } = chargeMetadata;
    this.logger.log(`Handling trial verification success for customer ${customerId}, targetPrice ${targetPriceId}`);

    // 1. Retrieve customer and ensure they haven't used trial before
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { user: true },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found.`);
    }

    if (customer.hasUsedTrial) {
      throw new BadRequestException("Customer has already used a free trial.");
    }

    // 2. Fetch target price configuration
    const targetPrice = await this.prisma.price.findUnique({
      where: { id: targetPriceId },
      include: { plan: true },
    });

    if (!targetPrice || !targetPrice.trialPeriodDays) {
      throw new BadRequestException("Selected price option is not eligible for free trial.");
    }

    // 3. Cache reusable card authorization locally
    if (paystackData.authorization?.reusable) {
      const auth = paystackData.authorization;
      await this.prisma.paymentMethod.upsert({
        where: { paystackAuthorizationCode: auth.authorization_code },
        update: { isDefault: true },
        create: {
          customerId: customer.id,
          paystackAuthorizationCode: auth.authorization_code,
          cardType: auth.card_type,
          bank: auth.bank,
          last4: auth.last4,
          expMonth: auth.exp_month,
          expYear: auth.exp_year,
          isReusable: true,
          isDefault: true,
        },
      });
    }

    // 4. Calculate trial duration dates
    const trialStart = new Date();
    const trialEnd = new Date(trialStart.getTime() + targetPrice.trialPeriodDays * 24 * 60 * 60 * 1000);

    // 5. Backend-managed: no need to register subscription on Paystack.
    // Card will be billed when trial period ends via the scheduler.
    const paystackSubscriptionCode = null;
    const paystackEmailToken = null;

    // 6. Asynchronously trigger the refund of the verification charge
    this.paystack.refundTransaction(reference).then(() => {
      this.logger.log(`Successfully requested refund of trial verification charge: ${reference}`);
    }).catch((err) => {
      this.logger.error(`Failed to refund trial verification charge ${reference}: ${err.message}`);
    });

    // 7. DB Transaction: save subscription, update customer eligibility, save transaction
    const subscription = await this.prisma.$transaction(async (tx) => {
      const incompleteSubId = chargeMetadata.subscriptionId;
      if (!incompleteSubId) {
        throw new BadRequestException("Subscription ID not found in verification metadata.");
      }

      const existingSub = await tx.subscription.findUnique({
        where: { id: incompleteSubId },
      });

      if (!existingSub) {
        throw new NotFoundException(`Incomplete subscription with ID ${incompleteSubId} not found.`);
      }

      const sub = await tx.subscription.update({
        where: { id: existingSub.id },
        data: {
          planId: targetPlanId,
          priceId: targetPriceId,
          status: SubscriptionStatus.TRIALING,
          trialStart,
          trialEnd,
          currentPeriodStart: trialStart,
          currentPeriodEnd: trialEnd,
          paystackSubscriptionCode,
          paystackEmailToken,
        },
        include: { plan: true, price: true },
      });

      // Record customer has used their trial quota
      await tx.customer.update({
        where: { id: customer.id },
        data: { hasUsedTrial: true },
      });

      // Record detailed change history
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: sub.id,
          changeType: SubscriptionChangeType.CREATED,
          toPlanId: targetPlanId,
          toPriceId: targetPriceId,
          toQuantity: 1,
          reason: `Free trial started for ${targetPrice.plan.name} (${targetPrice.trialPeriodDays} days).`,
          initiatedBy: "customer",
        },
      });

      // Mark the validation Transaction record status as SUCCESS
      await tx.transaction.updateMany({
        where: { paystackReference: reference },
        data: {
          status: "SUCCESS",
          channel: paystackData.channel || null,
          paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
        },
      });

      return sub;
    });

    return subscription;
  }

  /**
   * Confirms successful card update transaction.
   * Caches the customer's payment method card and auto-refunds the verification fee.
   */
  private async handleCardUpdateSuccess(reference: string, paystackData: any, chargeMetadata: any): Promise<any> {
    const { customerId } = chargeMetadata;
    this.logger.log(`Handling card update success for customer ${customerId}`);

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found.`);
    }

    let defaultPm = null;

    if (paystackData.authorization?.reusable) {
      const auth = paystackData.authorization;
      
      defaultPm = await this.prisma.$transaction(async (tx) => {
        // Reset defaults
        await tx.paymentMethod.updateMany({
          where: { customerId: customer.id },
          data: { isDefault: false },
        });

        return tx.paymentMethod.upsert({
          where: { paystackAuthorizationCode: auth.authorization_code },
          update: { isDefault: true },
          create: {
            customerId: customer.id,
            paystackAuthorizationCode: auth.authorization_code,
            cardType: auth.card_type,
            bank: auth.bank,
            last4: auth.last4,
            expMonth: auth.exp_month,
            expYear: auth.exp_year,
            isReusable: true,
            isDefault: true,
          },
        });
      });
    }

    // Refund the verification charge
    this.paystack.refundTransaction(reference).then(() => {
      this.logger.log(`Successfully requested refund of card update verification charge: ${reference}`);
    }).catch((err) => {
      this.logger.error(`Failed to refund card update verification charge ${reference}: ${err.message}`);
    });

    // Mark the verification Transaction record status as SUCCESS
    await this.prisma.transaction.updateMany({
      where: { paystackReference: reference },
      data: {
        status: "SUCCESS",
        channel: paystackData.channel || null,
        paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
      },
    });

    return defaultPm;
  }

  /**
   * Helper to create or reuse pending checkout records (SubscriptionPayment, Invoice, InvoiceItem, Transaction) inside a transaction.
   * Reuses any existing OPEN invoice for the subscription to avoid duplicates.
   */
  private async createPendingCheckoutRecords(params: {
    customer: any;
    subscription: any;
    targetPrice: any;
    amount: number;
    reference: string;
    invoicePrefix: string;
    invoiceItemType: InvoiceItemType;
    invoiceItemDescription: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<{ subPayment: any; invoice: any }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create PENDING SubscriptionPayment for this payment attempt
      const subPayment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: params.subscription.id,
          status: SubscriptionPaymentStatus.PENDING,
          amount: params.amount,
          currency: params.targetPrice.currency,
          paystackReference: params.reference,
          targetPriceId: params.targetPrice.id,
          targetPlanId: params.targetPrice.planId,
        },
      });

      // 2. Look for an existing OPEN invoice for this subscription
      let invoice = await tx.invoice.findFirst({
        where: {
          subscriptionId: params.subscription.id,
          status: "OPEN",
        },
      });

      if (invoice) {
        this.logger.log(`Reusing existing OPEN invoice ${invoice.id} for subscription ${params.subscription.id}`);
        invoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            subtotal: params.amount,
            total: params.amount,
            amountDue: params.amount,
            paystackReference: params.reference,
            dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days grace period
          },
        });

        // Recreate invoice items (delete existing and insert new)
        await tx.invoiceItem.deleteMany({
          where: { invoiceId: invoice.id },
        });

        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            type: params.invoiceItemType,
            description: params.invoiceItemDescription,
            quantity: 1,
            unitAmount: params.amount,
            amount: params.amount,
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
          },
        });
      } else {
        // Create a new OPEN billing Invoice
        const invoiceNumber = `${params.invoicePrefix}-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
        invoice = await tx.invoice.create({
          data: {
            customerId: params.customer.id,
            subscriptionId: params.subscription.id,
            invoiceNumber,
            status: "OPEN",
            currency: params.targetPrice.currency,
            subtotal: params.amount,
            total: params.amount,
            amountDue: params.amount,
            paystackReference: params.reference,
            dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days grace period
          },
        });

        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            type: params.invoiceItemType,
            description: params.invoiceItemDescription,
            quantity: 1,
            unitAmount: params.amount,
            amount: params.amount,
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
          },
        });
      }

      // 3. Create PENDING Transaction for this payment attempt
      await tx.transaction.create({
        data: {
          customerId: params.customer.id,
          invoiceId: invoice.id,
          status: "PENDING",
          amount: params.amount,
          paystackReference: params.reference,
        },
      });

      return { subPayment, invoice };
    });
  }

  /**
   * Cancels subscription at the period end.
   */
  async cancelSubscription(userId: string): Promise<SubscriptionResponseDto> {
    this.logger.log(`Initiating subscription cancellation for user ${userId}`);

    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException("Customer profile not found for this user.");
    }

    const sub = await this.prisma.subscription.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      include: { plan: true, price: true },
    });

    if (!sub) {
      throw new NotFoundException("No active, trialing, or past-due subscription found to cancel.");
    }

    if (sub.cancelAtPeriodEnd) {
      throw new BadRequestException("Subscription is already set to cancel at period end.");
    }

    if (sub.plan.slug === "free") {
      throw new BadRequestException("Cannot cancel a subscription on the Free plan.");
    }

    // Update locally in database
    const updatedSub = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          cancelAtPeriodEnd: true,
          canceledAt: new Date(),
          cancelAt: sub.currentPeriodEnd,
        },
        include: { plan: true, price: true },
      });

      await tx.subscriptionChange.create({
        data: {
          subscriptionId: sub.id,
          changeType: SubscriptionChangeType.CANCELLATION,
          fromPlanId: sub.planId,
          fromPriceId: sub.priceId,
          reason: "Customer requested subscription cancellation.",
          initiatedBy: "customer",
          prorationAmount: 0,
          effectiveAt: sub.currentPeriodEnd,
        },
      });

      return updated;
    });

    return SubscriptionMapper.toSubscriptionResponse(updatedSub);
  }

  /**
   * Generates a link to update card details for a subscription.
   */
  async generateChangeCardLink(userId: string): Promise<{ link: string }> {
    this.logger.log(`Generating card update link for user ${userId}`);

    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!customer) {
      throw new NotFoundException("Customer profile not found for this user.");
    }

    const sub = await this.prisma.subscription.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
      include: { plan: true },
    });

    if (!sub) {
      throw new NotFoundException("No active, trialing, or past-due subscription found.");
    }

    if (sub.plan.slug === "free") {
      throw new BadRequestException("Cannot update payment method for the Free plan.");
    }

    const reference = `card_update_${customer.id}_${crypto.randomUUID().substring(0, 12)}`;
    const CARD_VERIFICATION_AMOUNT = 50; // 50 NGN

    try {
      const paystackTx = await this.paystack.initializeTransaction({
        email: customer.user.email,
        amount: CARD_VERIFICATION_AMOUNT,
        reference,
        metadata: {
          customerId: customer.id,
          subscriptionId: sub.id,
          type: "CARD_UPDATE",
        },
      });

      // Persist pending Transaction record
      await this.prisma.transaction.create({
        data: {
          customerId: customer.id,
          status: "PENDING",
          amount: CARD_VERIFICATION_AMOUNT,
          paystackReference: reference,
        },
      });

      return { link: paystackTx.authorization_url };
    } catch (err: any) {
      this.logger.error(`Failed to initialize card update transaction: ${err.message}`);
      throw new BadRequestException(`Paystack initialization failed: ${err.message}`);
    }
  }

  /**
   * Synchronizes subscription card details from Paystack to database.
   */
  async syncSubscriptionCard(userId: string): Promise<any> {
    this.logger.log(`Synchronizing subscription card details for user ${userId}`);

    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException("Customer profile not found for this user.");
    }

    const defaultPm = await this.prisma.paymentMethod.findFirst({
      where: { customerId: customer.id, isDefault: true },
    });

    if (!defaultPm) {
      throw new NotFoundException("No payment card registered for this customer. Please add a payment method.");
    }

    return defaultPm;
  }

  private async handleRenewalSuccess(reference: string, paystackData: any, chargeMetadata: any): Promise<any> {
    const { invoiceId, subscriptionId } = chargeMetadata;
    this.logger.log(`Handling renewal success for subscription ${subscriptionId}, invoice ${invoiceId}`);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: { include: { plan: true, price: true, customer: { include: { user: true } } } } },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found during renewal confirmation.`);
    }

    if (invoice.status === "PAID") {
      this.logger.log(`Invoice ${invoiceId} is already PAID. Skipping duplicate updates.`);
      return invoice.subscription;
    }

    const sub = invoice.subscription;
    const paidDate = paystackData.paid_at ? new Date(paystackData.paid_at) : new Date();
    const nextPeriodStart = sub.currentPeriodEnd;
    const nextPeriodEnd = computePeriodEnd(sub.price.interval, nextPeriodStart);

    return this.prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: { paystackReference: reference },
        data: {
          status: "SUCCESS",
          paidAt: paidDate,
          channel: paystackData.channel || null,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "PAID",
          amountPaid: invoice.total,
          amountDue: 0,
          paidAt: paidDate,
          paystackReference: reference,
        },
      });

      const updatedSub = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: nextPeriodStart,
          currentPeriodEnd: nextPeriodEnd,
        },
        include: { plan: true, price: true },
      });

      await tx.dunningAttempt.updateMany({
        where: { invoiceId: invoice.id, status: "SCHEDULED" },
        data: { status: "SUCCESS" },
      });

      await this.emailQueue.enqueueEmail({
        recipients: [sub.customer.user.email],
        subject: `Invoice receipt for your ${sub.plan.name} renewal`,
        template: "invoice-receipt",
        contextItems: {
          customerName: sub.customer.user.name,
          invoiceNumber: invoice.invoiceNumber,
          amountPaid: invoice.total.toFixed(2),
          currency: sub.price.currency,
          periodEnd: nextPeriodEnd.toLocaleDateString(),
        },
      });

      this.logger.log(`Subscription ${sub.id} successfully renewed until ${nextPeriodEnd}`);
      return updatedSub;
    });
  }

  private async handleDunningRetrySuccess(reference: string, paystackData: any, chargeMetadata: any): Promise<any> {
    const { invoiceId, subscriptionId, dunningAttemptId } = chargeMetadata;
    this.logger.log(`Handling dunning retry success for subscription ${subscriptionId}, invoice ${invoiceId}, attempt ${dunningAttemptId}`);

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: { include: { plan: true, price: true, customer: { include: { user: true } } } } },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found during dunning confirmation.`);
    }

    if (invoice.status === "PAID") {
      this.logger.log(`Invoice ${invoiceId} is already PAID. Skipping duplicate dunning recovery.`);
      return invoice.subscription;
    }

    const sub = invoice.subscription;
    const paidDate = paystackData.paid_at ? new Date(paystackData.paid_at) : new Date();
    const nextPeriodStart = sub.currentPeriodEnd;
    const nextPeriodEnd = computePeriodEnd(sub.price.interval, nextPeriodStart);

    return this.prisma.$transaction(async (tx) => {
      if (dunningAttemptId) {
        await tx.dunningAttempt.update({
          where: { id: dunningAttemptId },
          data: { status: "SUCCESS" },
        });
      }

      await tx.dunningAttempt.updateMany({
        where: { invoiceId: invoice.id, status: "SCHEDULED" },
        data: { status: "SUCCESS" },
      });

      await tx.transaction.updateMany({
        where: { paystackReference: reference },
        data: {
          status: "SUCCESS",
          paidAt: paidDate,
          channel: paystackData.channel || null,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "PAID",
          amountPaid: invoice.total,
          amountDue: 0,
          paidAt: paidDate,
          paystackReference: reference,
        },
      });

      const updatedSub = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          currentPeriodStart: nextPeriodStart,
          currentPeriodEnd: nextPeriodEnd,
        },
        include: { plan: true, price: true },
      });

      await this.emailQueue.enqueueEmail({
        recipients: [sub.customer.user.email],
        subject: `Payment successful - subscription recovered!`,
        template: "payment-recovered",
        contextItems: {
          customerName: sub.customer.user.name,
          invoiceNumber: invoice.invoiceNumber,
          amountPaid: invoice.total.toFixed(2),
          currency: invoice.currency,
        },
      });

      this.logger.log(`Dunning recovered subscription ${sub.id}. Service restored.`);
      return updatedSub;
    });
  }

  async processFailedPayment(reference: string, paystackData: any): Promise<any> {
    this.logger.log(`Processing failed payment for reference: ${reference}`);

    const chargeMetadata = paystackData?.metadata;
    if (!chargeMetadata) {
      this.logger.warn(`No metadata found in failed payment reference: ${reference}. Skipping.`);
      return;
    }

    const { invoiceId, subscriptionId, dunningAttemptId, type } = chargeMetadata;

    const transaction = await this.prisma.transaction.findFirst({
      where: { paystackReference: reference },
    });

    if (transaction && transaction.status === "FAILED") {
      this.logger.log(`Transaction for reference ${reference} is already marked FAILED. Skipping.`);
      return;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({
        where: { paystackReference: reference },
        data: { status: "FAILED" },
      });

      if (type === "RENEWAL_CHARGE") {
        this.logger.log(`Processing renewal charge failure for subscription ${subscriptionId}, invoice ${invoiceId}`);
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
        });
        const sub = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true, customer: { include: { user: true } } },
        });

        if (!invoice || !sub) {
          throw new NotFoundException("Invoice or subscription not found for failed renewal.");
        }

        if (invoice.status === "PAID") {
          this.logger.warn(`Renewal invoice ${invoiceId} is already PAID. Ignoring failed webhook callback.`);
          return;
        }

        const existingDunning = await tx.dunningAttempt.findFirst({
          where: { invoiceId: invoice.id },
        });

        if (existingDunning) {
          this.logger.log(`Dunning sequence already active for invoice ${invoiceId}. Skipping.`);
          return;
        }

        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: SubscriptionStatus.PAST_DUE },
        });

        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: "OVERDUE" },
        });

        const nextRetryDate = new Date();
        nextRetryDate.setDate(nextRetryDate.getDate() + 1);

        await tx.dunningAttempt.create({
          data: {
            invoiceId: invoice.id,
            attemptNumber: 1,
            status: "SCHEDULED",
            scheduledAt: nextRetryDate,
            failureReason: paystackData.gateway_response || "Card charge failed.",
          },
        });

        await this.emailQueue.enqueueEmail({
          recipients: [sub.customer.user.email],
          subject: `Payment failed for your ${sub.plan.name} subscription renewal`,
          template: "dunning-warning",
          contextItems: {
            customerName: sub.customer.user.name,
            invoiceNumber: invoice.invoiceNumber,
            amountDue: invoice.total.toFixed(2),
            currency: invoice.currency,
            attemptNumber: 1,
            nextRetryDate: nextRetryDate.toLocaleDateString(),
          },
        });

        this.logger.log(`Renewal charge failed. Initiated dunning sequence for subscription ${sub.id}. Attempt 1 scheduled.`);
      }

      if (type === "DUNNING_RETRY") {
        this.logger.log(`Processing dunning retry failure for subscription ${subscriptionId}, invoice ${invoiceId}, attempt ID ${dunningAttemptId}`);

        const retry = await tx.dunningAttempt.findUnique({
          where: { id: dunningAttemptId },
        });

        if (!retry || retry.status !== "SCHEDULED") {
          this.logger.warn(`Dunning attempt ${dunningAttemptId} not found or already processed.`);
          return;
        }

        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
        });
        const sub = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true, customer: { include: { user: true } } },
        });

        if (!invoice || !sub || !retry) {
          throw new NotFoundException("Metadata relations not found for failed dunning retry.");
        }

        if (invoice.status === "PAID") {
          this.logger.warn(`Invoice ${invoiceId} is already PAID. Skipping failed dunning updates.`);
          return;
        }

        const attemptNumber = retry.attemptNumber;
        const failureReason = paystackData.gateway_response || "Card charge failed.";

        await tx.dunningAttempt.update({
          where: { id: retry.id },
          data: { status: "FAILED" },
        });

        if (attemptNumber < 5) {
          const nextAttemptNumber = attemptNumber + 1;
          const nextRetryDate = new Date();
          const delayDays = nextAttemptNumber === 2 ? 1 : 2;
          nextRetryDate.setDate(nextRetryDate.getDate() + delayDays);

          await tx.dunningAttempt.create({
            data: {
              invoiceId: invoice.id,
              attemptNumber: nextAttemptNumber,
              status: "SCHEDULED",
              scheduledAt: nextRetryDate,
              failureReason,
            },
          });

          await this.emailQueue.enqueueEmail({
            recipients: [sub.customer.user.email],
            subject: `Renewal Payment Failed - Attempt ${attemptNumber}/5`,
            template: "dunning-warning",
            contextItems: {
              customerName: sub.customer.user.name,
              invoiceNumber: invoice.invoiceNumber,
              amountDue: invoice.total.toFixed(2),
              currency: invoice.currency,
              attemptNumber,
              nextRetryDate: nextRetryDate.toLocaleDateString(),
            },
          });
          this.logger.log(`Dunning attempt ${attemptNumber} failed. Scheduled next retry ${nextAttemptNumber} for ${nextRetryDate}`);
        } else {
          this.logger.error(`Dunning failed all 5 attempts for subscription ${sub.id}. Restricting account.`);

          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: "UNCOLLECTIBLE" },
          });

          const freePlanSetting = await tx.systemSetting.findUnique({
            where: { key: "FREE_PLAN_AUTO_SUBSCRIBE" },
          });
          const isFreeEnabled = freePlanSetting ? freePlanSetting.value === "true" : true;

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
                  currentPeriodStart: new Date(),
                  currentPeriodEnd: computePeriodEnd(freePrice.interval),
                },
              });

              await tx.subscriptionChange.create({
                data: {
                  subscriptionId: sub.id,
                  changeType: "DOWNGRADE",
                  fromPlanId: sub.planId,
                  toPlanId: freePlan.id,
                  fromPriceId: sub.priceId,
                  toPriceId: freePrice.id,
                  reason: "Downgraded to Free Plan after 5 unsuccessful renewal payment attempts (dunning timeout).",
                  initiatedBy: "system:dunning",
                },
              });
            }
          } else {
            await tx.subscription.update({
              where: { id: sub.id },
              data: { status: SubscriptionStatus.RESTRICTED },
            });

            await tx.subscriptionChange.create({
              data: {
                subscriptionId: sub.id,
                changeType: SubscriptionChangeType.PAUSE,
                fromPlanId: sub.planId,
                fromPriceId: sub.priceId,
                reason: "Suspended after 5 unsuccessful renewal payment attempts (dunning timeout).",
                initiatedBy: "system:dunning",
              },
            });
          }

          await this.emailQueue.enqueueEmail({
            recipients: [sub.customer.user.email],
            subject: `Subscription Restricted - Payment Failed`,
            template: "dunning-failed-restricted",
            contextItems: {
              customerName: sub.customer.user.name,
              invoiceNumber: invoice.invoiceNumber,
            },
          });
        }
      }
    });
  }
}