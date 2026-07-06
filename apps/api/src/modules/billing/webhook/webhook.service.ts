import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { SubscriptionStatus, SubscriptionChangeType } from "prisma/generated/prisma/client";
import { SubscriptionService } from "../subscription/subscription.service";

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService
  ) { }


  async handleEvent(event: string, data: any): Promise<void> {
    this.logger.log(`Handling Paystack webhook event: ${event}`);

    switch (event) {
      case "charge.success":
        await this.handleChargeSuccess(data);
        break;
      case "subscription.create":
        await this.handleSubscriptionCreate(data);
        break;
      case "subscription.disable":
        await this.handleSubscriptionDisable(data);
        break;
      case "invoice.create":
        await this.handleInvoiceCreate(data);
        break;
      case "invoice.payment_failed":
        await this.handleInvoicePaymentFailed(data);
        break;
      default:
        this.logger.log(`Unhandled webhook event category: ${event}`);
    }
  }

  /**
   * Fired when a payment is successful.
   */
  private async handleChargeSuccess(data: any): Promise<void> {
    const reference = data.reference;
    this.logger.log(`Processing successful charge. Reference: ${reference}`);

    try {
      await this.subscriptionService.processSuccessfulPayment(reference, data);
      this.logger.log(`Successfully processed charge.success updates for reference: ${reference}`);
    } catch (error: any) {
      this.logger.error(`Error processing charge.success webhook for reference ${reference}: ${error.message}`, error.stack);
    }
  }

  /**
   * Fired when subscription creation succeeds on Paystack.
   */
  private async handleSubscriptionCreate(data: any): Promise<void> {
    const subCode = data.subscription_code;
    const emailToken = data.email_token;
    const customerCode = data.customer?.customer_code;
    const planCode = data.plan?.plan_code;

    this.logger.log(`Paystack Subscription Created. Code: ${subCode}, Plan: ${planCode}`);

    // Retrieve local customer
    const customer = await this.prisma.customer.findUnique({
      where: { paystackCustomerId: customerCode },
    });

    if (!customer) {
      this.logger.error(`Unable to find customer registry for subscription creation event. Code: ${customerCode}`);
      return;
    }

    // Link subscription details to customer's single local subscription
    const matchedSub = await this.prisma.subscription.findFirst({
      where: {
        customerId: customer.id,
      },
    });

    if (matchedSub) {
      await this.prisma.subscription.update({
        where: { id: matchedSub.id },
        data: {
          paystackSubscriptionCode: subCode,
          paystackEmailToken: emailToken,
        },
      });
      this.logger.log(`Successfully linked Paystack subscription code ${subCode} to local subscription ${matchedSub.id}`);
    } else {
      this.logger.warn(`No local subscription found matching customer ${customer.id}`);
    }
  }

  /**
   * Webhook: subscription.disable
   * Fired when subscription is disabled.
   * IMPLEMENTED DEEP CONFLICT SAFETY CHECK: If the disable corresponds to an older plan code
   * that was replaced by an upgrade, we IGNORE it.
   */
  private async handleSubscriptionDisable(data: any): Promise<void> {
    const subCode = data.subscription_code;
    const email = data.customer?.email;

    this.logger.log(`Processing subscription disable event. Code: ${subCode}`);

    // Locate the subscription record
    const sub = await this.prisma.subscription.findFirst({
      where: { paystackSubscriptionCode: subCode },
      include: { customer: { include: { user: true } } },
    });

    if (!sub) {
      this.logger.warn(`No database subscription record matched Paystack code ${subCode}`);
      return;
    }

    // Fetch the customer's *current active* subscription
    const currentActiveSub = await this.prisma.subscription.findFirst({
      where: {
        customerId: sub.customerId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
      },
    });

    // CONFLICT CHECK:
    // If the customer has an active subscription in our DB with a DIFFERENT paystack code,
    // it means they upgraded, and Paystack disabled the old code. We must ignore the event.
    if (
      currentActiveSub &&
      currentActiveSub.paystackSubscriptionCode &&
      currentActiveSub.paystackSubscriptionCode !== subCode
    ) {
      this.logger.log(
        `Subscription ${subCode} was disabled due to plan modification/upgrade. Current active subscription is ${currentActiveSub.paystackSubscriptionCode}. Ignoring disable event.`
      );
      return;
    }

    // Otherwise, this is a real cancellation (e.g. user initiated or failed retries)
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.CANCELED,
          endedAt: new Date(),
        },
      });

      await tx.subscriptionChange.create({
        data: {
          subscriptionId: sub.id,
          changeType: SubscriptionChangeType.CANCELLATION,
          fromPlanId: sub.planId,
          fromPriceId: sub.priceId,
          reason: "Canceled on Paystack (subscription.disable webhook).",
          initiatedBy: "system:payment_provider",
        },
      });
    });

    this.logger.log(`Subscription ${sub.id} successfully restricted / canceled.`);
  }

  /**
   * Webhook: invoice.create (Paystack auto-creates invoices for renewals)
   */
  private async handleInvoiceCreate(data: any): Promise<void> {
    const subCode = data.subscription?.subscription_code;
    const customerCode = data.customer?.customer_code;
    if (!subCode) return;

    this.logger.log(`Received invoice.create webhook for Paystack subscription: ${subCode}`);

    const customer = await this.prisma.customer.findUnique({
      where: { paystackCustomerId: customerCode },
    });

    if (!customer) {
      this.logger.warn(`No matching customer found for code ${customerCode}`);
      return;
    }
    const subscription = await this.prisma.subscription.findUnique({
      where: { paystackSubscriptionCode: subCode, customerId: customer.id },
    });

    if (!subscription) {
      this.logger.warn(`No matching subscription found for code ${subCode}`);
      return;
    }

    // Check if an OPEN or DRAFT invoice already exists for this subscription
    const existing = await this.prisma.invoice.findFirst({
      where: {
        subscriptionId: subscription.id,
        customerId: customer.id,
        status: { in: ["OPEN", "DRAFT"] },
      },
    });

    if (existing) {
      this.logger.log(`An OPEN or DRAFT invoice already exists for subscription ${subscription.id}. Skipping creation.`);
      return;
    }

    // Create a local open invoice record to track the pending renewal/charge cycle
    const invoiceNumber = data.invoice_code || `INV-RENEW-${Date.now()}`;
    await this.prisma.invoice.create({
      data: {
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        invoiceNumber,
        status: "OPEN",
        currency: data.currency || "NGN",
        subtotal: data.amount,
        total: data.amount,
        amountDue: data.amount,
        dueDate: data.next_payment_date ? new Date(data.next_payment_date) : new Date(),
        paystackReference: data.transaction?.reference || undefined,
      },
    });
  }

  /**
   * Webhook: invoice.payment_failed (dunning tracking)
   */
  private async handleInvoicePaymentFailed(data: any): Promise<void> {
    const subCode = data.subscription?.subscription_code;
    if (!subCode) return;

    this.logger.warn(`Paystack billing renewal invoice payment failed for subscription: ${subCode}`);

    const subscription = await this.prisma.subscription.findUnique({
      where: { paystackSubscriptionCode: subCode },
    });

    if (!subscription) return;

    await this.prisma.$transaction(async (tx) => {
      // 1. Transition subscription status to PAST_DUE
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.PAST_DUE },
      });

      // 2. Record Failed Dunning attempt
      const lastInvoice = await tx.invoice.findFirst({
        where: { subscriptionId: subscription.id },
        orderBy: { createdAt: "desc" },
      });

      if (lastInvoice) {
        await tx.invoice.update({
          where: { id: lastInvoice.id },
          data: { status: "OVERDUE" },
        });

        // Count previous attempts
        const attemptCount = await tx.dunningAttempt.count({
          where: { invoiceId: lastInvoice.id },
        });

        await tx.dunningAttempt.create({
          data: {
            invoiceId: lastInvoice.id,
            attemptNumber: attemptCount + 1,
            status: "FAILED",
            scheduledAt: new Date(),
            executedAt: new Date(),
            failureReason: data.gateway_response || "Payment transaction failed.",
          },
        });
      }
    });
  }
}
