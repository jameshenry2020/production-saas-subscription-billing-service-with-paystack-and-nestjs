import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { WebhookService } from "../src/modules/billing/webhook/webhook.service";
import { SubscriptionService } from "../src/modules/billing/subscription/subscription.service";
import { PaystackService } from "../src/modules/billing/paystack/paystack.service";
import { EmailService } from "../src/infrastructure/mails/email.service";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { SubscriptionStatus, SubscriptionPaymentStatus } from "prisma/generated/prisma/client";

async function run() {
  console.log("Initializing NestJS Application Context...");
  const app = await NestFactory.createApplicationContext(AppModule);

  const prisma = app.get(PrismaService);
  const webhookService = app.get(WebhookService);
  const subscriptionService = app.get(SubscriptionService);
  const paystackService = app.get(PaystackService);
  const emailService = app.get(EmailService);

  console.log("Mocking EmailService and PaystackService...");
  
  // Track email calls
  let sentEmails: any[] = [];
  emailService.sendEmail = async (payload: any) => {
    console.log(">>> [MOCK EMAIL] sendEmail called with:", JSON.stringify(payload, null, 2));
    sentEmails.push(payload);
    return Promise.resolve();
  };

  // Mock Paystack APIs
  let disableSubCalled = false;
  let disableSubArgs: any = null;
  paystackService.disableSubscription = async (params: any) => {
    console.log(">>> [MOCK PAYSTACK] disableSubscription called with:", params);
    disableSubCalled = true;
    disableSubArgs = params;
    return Promise.resolve();
  };

  let createSubCalled = false;
  let createSubArgs: any = null;
  paystackService.createSubscription = async (params: any) => {
    console.log(">>> [MOCK PAYSTACK] createSubscription called with:", params);
    createSubCalled = true;
    createSubArgs = params;
    return Promise.resolve({
      subscription_code: "SUB_MOCKED_NEW_123",
      email_token: "MOCKED_TOKEN_456",
    } as any);
  };

  // Setup test data
  console.log("Setting up dummy test data in database...");
  const suffix = Date.now().toString().slice(-6);
  const email = `test-renewal-cycle-${suffix}@example.com`;
  
  const product = await prisma.product.create({
    data: { name: `Test Product ${suffix}`, slug: `test-product-${suffix}` },
  });

  const plan = await prisma.plan.create({
    data: { productId: product.id, name: `Pro Plan ${suffix}`, slug: `pro-plan-${suffix}`, sortOrder: 1 },
  });

  const planUpgrade = await prisma.plan.create({
    data: { productId: product.id, name: `Max Plan ${suffix}`, slug: `max-plan-${suffix}`, sortOrder: 2 },
  });

  const price = await prisma.price.create({
    data: { planId: plan.id, interval: "MONTHLY", amount: 150000, paystackPlanCode: `PLN_old_${suffix}` },
  });

  const targetPrice = await prisma.price.create({
    data: { planId: planUpgrade.id, interval: "MONTHLY", amount: 300000, paystackPlanCode: `PLN_upgraded_${suffix}` },
  });

  // 2. Create User, Customer, and Subscription
  const user = await prisma.user.create({
    data: { email, name: "Test Dunning User" },
  });

  const customer = await prisma.customer.create({
    data: { userId: user.id, paystackCustomerId: `CUST_MOCKED_${suffix}` },
  });

  const subCode = `SUB_MOCKED_OLD_${Date.now()}`;
  const subscription = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      planId: plan.id,
      priceId: price.id,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
      paystackSubscriptionCode: subCode,
      paystackEmailToken: "TOKEN_OLD",
    },
  });

  // Create an open invoice for this subscription
  const invoice = await prisma.invoice.create({
    data: {
      customerId: customer.id,
      subscriptionId: subscription.id,
      invoiceNumber: `INV-MOCK-TEST-${Date.now()}`,
      status: "OPEN",
      currency: "NGN",
      subtotal: price.amount,
      total: price.amount,
      amountDue: price.amount,
    },
  });

  console.log("Test data setup complete. Sub code:", subCode);

  // ================= SCENARIO 1: invoice.payment_failed (Attention) =================
  console.log("\n--------------------------------------------------");
  console.log("SCENARIO 1: Simulating invoice.payment_failed (with status 'attention')");
  console.log("--------------------------------------------------");

  const paymentFailedPayload = {
    amount: 150000,
    gateway_response: "Insufficient Funds",
    attempt_count: 2,
    next_payment_attempt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    subscription: {
      subscription_code: subCode,
      status: "attention",
    },
  };

  await webhookService.handleEvent("invoice.payment_failed", paymentFailedPayload);

  // Verify status in DB
  const updatedSub1 = await prisma.subscription.findUnique({ where: { id: subscription.id } });
  console.log("Updated Subscription status in DB:", updatedSub1?.status); // Expected: PAST_DUE

  const updatedInvoice1 = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  console.log("Updated Invoice status in DB:", updatedInvoice1?.status); // Expected: OVERDUE
  console.log("Updated Invoice attemptCount:", updatedInvoice1?.attemptCount); // Expected: 2
  console.log("Updated Invoice nextPaymentAttempt:", updatedInvoice1?.nextPaymentAttempt);

  const dunningCount = await prisma.dunningAttempt.count({ where: { invoiceId: invoice.id } });
  console.log("Dunning attempts in DB:", dunningCount); // Expected: 1

  console.log("Dunning email sent count:", sentEmails.length); // Expected: 1
  if (sentEmails.length > 0) {
    console.log("Sent Email Target:", sentEmails[0].recipients);
    console.log("Sent Email Subject:", sentEmails[0].subject);
    console.log("Sent Email Template:", sentEmails[0].template);
    console.log("Sent Email Context:", JSON.stringify(sentEmails[0].contextItems));
  }

  // ================= SCENARIO 2: invoice.update (Success) =================
  console.log("\n--------------------------------------------------");
  console.log("SCENARIO 2: Simulating invoice.update (with status 'success' / recovery)");
  console.log("--------------------------------------------------");

  // For Case 1 renewal payment (no pre-existing SubscriptionPayment), it matches Paystack sub code
  const invoiceUpdateSuccessPayload = {
    status: "success",
    amount: 150000,
    paid_at: new Date().toISOString(),
    channel: "card",
    subscription: {
      subscription_code: subCode,
      status: "active",
    },
    transaction: {
      reference: `ref_mock_renew_${Date.now()}`,
      status: "success",
    },
  };

  await webhookService.handleEvent("invoice.update", invoiceUpdateSuccessPayload);

  const updatedSub2 = await prisma.subscription.findUnique({ where: { id: subscription.id } });
  console.log("Updated Subscription status after invoice.update success:", updatedSub2?.status); // Expected: ACTIVE
  console.log("Subscription Period End Rolled Over:", updatedSub2?.currentPeriodEnd);

  const updatedInvoice2 = await prisma.invoice.findUnique({ where: { id: invoice.id } });
  console.log("Updated Invoice status after invoice.update success:", updatedInvoice2?.status); // Expected: PAID

  // ================= SCENARIO 3: PLAN_CHANGE_UPGRADE (Upgrade Sync) =================
  console.log("\n--------------------------------------------------");
  console.log("SCENARIO 3: Simulating Upgrade checkout payment confirmation");
  console.log("--------------------------------------------------");

  const upgradeRef = `ref_mock_upgrade_${Date.now()}`;
  
  // Create pending SubscriptionPayment record representing the upgrade
  await prisma.subscriptionPayment.create({
    data: {
      subscriptionId: subscription.id,
      status: SubscriptionPaymentStatus.PENDING,
      amount: 150000, // proration charge
      currency: "NGN",
      paystackReference: upgradeRef,
      targetPriceId: targetPrice.id,
      targetPlanId: targetPrice.planId,
    },
  });

  // Pre-create the transaction record linked to this reference
  await prisma.transaction.create({
    data: {
      customerId: customer.id,
      status: "PENDING",
      amount: 150000,
      paystackReference: upgradeRef,
    },
  });

  const upgradeSuccessPayload = {
    reference: upgradeRef,
    status: "success",
    amount: 150000,
    paid_at: new Date().toISOString(),
    channel: "card",
    metadata: {
      customerId: customer.id,
      subscriptionId: subscription.id,
      type: "PLAN_CHANGE_UPGRADE",
      targetPlanId: targetPrice.planId,
      targetPriceId: targetPrice.id,
    },
    transaction: {
      reference: upgradeRef,
      status: "success",
    },
  };

  // Simulate charge.success webhook event for this reference
  await webhookService.handleEvent("charge.success", upgradeSuccessPayload);

  // Check if Paystack disable/create subscription APIs were called
  console.log("Paystack disableSubscription called:", disableSubCalled); // Expected: true
  console.log("Paystack disableSubscription args:", disableSubArgs); // Expected: code matching old sub code
  console.log("Paystack createSubscription called:", createSubCalled); // Expected: true
  console.log("Paystack createSubscription args plan:", createSubArgs?.plan); // Expected: target plan code
  console.log("Paystack createSubscription args startDate:", createSubArgs?.startDate); // Expected: target date matching currentPeriodEnd

  // Verify updated Subscription plan and paystack codes in DB
  const updatedSub3 = await prisma.subscription.findUnique({ where: { id: subscription.id } });
  console.log("Final Subscription Plan ID in DB (Upgraded):", updatedSub3?.planId === plan.id); 
  console.log("Final Subscription Price ID in DB (Upgraded):", updatedSub3?.priceId === targetPrice.id);
  console.log("Final Paystack Subscription Code in DB (Mocked New):", updatedSub3?.paystackSubscriptionCode); // Expected: SUB_MOCKED_NEW_123
  console.log("Final Paystack Email Token in DB (Mocked New):", updatedSub3?.paystackEmailToken); // Expected: MOCKED_TOKEN_456

  console.log("\nCleanup: Removing test records...");
  await prisma.subscriptionChange.deleteMany({ where: { subscriptionId: subscription.id } });
  await prisma.dunningAttempt.deleteMany({ where: { invoice: { customerId: customer.id } } });
  await prisma.invoiceItem.deleteMany({ where: { invoice: { customerId: customer.id } } });
  await prisma.invoice.deleteMany({ where: { customerId: customer.id } });
  await prisma.transaction.deleteMany({ where: { customerId: customer.id } });
  await prisma.subscriptionPayment.deleteMany({ where: { subscriptionId: subscription.id } });
  await prisma.subscription.delete({ where: { id: subscription.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.price.delete({ where: { id: targetPrice.id } });
  await prisma.price.delete({ where: { id: price.id } });
  await prisma.plan.delete({ where: { id: planUpgrade.id } });
  await prisma.plan.delete({ where: { id: plan.id } });
  await prisma.product.delete({ where: { id: product.id } });

  console.log("Verification run complete!");
  app.close();
}

run().catch((err) => {
  console.error("Error running verification:", err);
  process.exit(1);
});
