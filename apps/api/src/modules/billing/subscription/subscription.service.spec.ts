import { Test, TestingModule } from "@nestjs/testing";
import { SubscriptionService } from "./subscription.service";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { PaystackService } from "../paystack/paystack.service";
import { IdempotencyService } from "../../../common/idempotency/idempotency.service";
import { SystemSettingService } from "../../../infrastructure/settings/system-setting.service";
import { EmailQueueService } from "../../../infrastructure/mails/email-queue.service";
import { UsageService } from "../usage/usage.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { SubscriptionStatus, SubscriptionChangeType } from "prisma/generated/prisma/client";

describe("SubscriptionService (Unit)", () => {
  let service: SubscriptionService;
  let prisma: PrismaService;
  let paystack: PaystackService;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    subscriptionChange: {
      create: jest.fn(),
    },
    paymentMethod: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockPaystack = {
    disableSubscription: jest.fn(),
    getSubscriptionManageLink: jest.fn(),
    fetchSubscription: jest.fn(),
    initializeTransaction: jest.fn(),
    refundTransaction: jest.fn(),
  };

  const mockIdempotency = {};
  const mockSystemSetting = {};
  const mockEmailQueue = {
    enqueueEmail: jest.fn(),
  };
  const mockUsageService = {
    trackUsageByUserId: jest.fn(),
    trackUsage: jest.fn(),
    checkUsage: jest.fn(),
    toggleOverage: jest.fn(),
    rolloverUsageSummaries: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaystackService, useValue: mockPaystack },
        { provide: IdempotencyService, useValue: mockIdempotency },
        { provide: SystemSettingService, useValue: mockSystemSetting },
        { provide: EmailQueueService, useValue: mockEmailQueue },
        { provide: UsageService, useValue: mockUsageService },
      ],
    }).compile();

    service = module.get<SubscriptionService>(SubscriptionService);
    prisma = module.get<PrismaService>(PrismaService);
    paystack = module.get<PaystackService>(PaystackService);

    jest.clearAllMocks();
  });

  describe("cancelSubscription", () => {
    it("should throw NotFoundException if customer profile is not found", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.cancelSubscription("user-123")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw NotFoundException if no active, trialing, or past_due subscription is found", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: "cust-123" });
      mockPrisma.subscription.findFirst.mockResolvedValue(null);

      await expect(service.cancelSubscription("user-123")).rejects.toThrow(
        NotFoundException
      );
    });

    it("should throw BadRequestException if subscription is already set to cancel", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: "cust-123" });
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: "sub-123",
        cancelAtPeriodEnd: true,
        plan: { slug: "pro" },
      });

      await expect(service.cancelSubscription("user-123")).rejects.toThrow(
        BadRequestException
      );
    });

    it("should throw BadRequestException if subscription is on the Free plan", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: "cust-123" });
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: "sub-123",
        cancelAtPeriodEnd: false,
        plan: { slug: "free" },
      });

      await expect(service.cancelSubscription("user-123")).rejects.toThrow(
        BadRequestException
      );
    });

    it("should update DB locally to cancel subscription", async () => {
      const now = new Date();
      mockPrisma.customer.findUnique.mockResolvedValue({ id: "cust-123" });
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: "sub-123",
        planId: "plan-123",
        priceId: "price-123",
        cancelAtPeriodEnd: false,
        paystackSubscriptionCode: "SUB_abc123",
        paystackEmailToken: "token-123",
        currentPeriodEnd: now,
        plan: { slug: "pro", name: "Pro Plan" },
        price: { amount: 10000 },
      });

      mockPrisma.subscription.update.mockResolvedValue({
        id: "sub-123",
        planId: "plan-123",
        priceId: "price-123",
        cancelAtPeriodEnd: true,
        paystackSubscriptionCode: "SUB_abc123",
        currentPeriodEnd: now,
        plan: { slug: "pro", name: "Pro Plan" },
        price: { amount: 10000 },
      });

      const response = await service.cancelSubscription("user-123");

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: "sub-123" },
        data: {
          cancelAtPeriodEnd: true,
          canceledAt: expect.any(Date),
          cancelAt: now,
        },
        include: { plan: true, price: true },
      });
      expect(prisma.subscriptionChange.create).toHaveBeenCalledWith({
        data: {
          subscriptionId: "sub-123",
          changeType: SubscriptionChangeType.CANCELLATION,
          fromPlanId: "plan-123",
          fromPriceId: "price-123",
          reason: "Customer requested subscription cancellation.",
          initiatedBy: "customer",
          prorationAmount: 0,
          effectiveAt: now,
        },
      });
      expect(response.cancelAtPeriodEnd).toBe(true);
    });
  });

  describe("generateChangeCardLink", () => {
    it("should generate change card link successfully", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({
        id: "cust-123",
        user: { email: "user@example.com" },
      });
      mockPrisma.subscription.findFirst.mockResolvedValue({
        id: "sub-123",
        plan: { slug: "pro" },
        paystackSubscriptionCode: "SUB_abc123",
      });
      mockPaystack.initializeTransaction.mockResolvedValue({
        authorization_url: "https://checkout.paystack.com/card-update-link",
      });

      const response = await service.generateChangeCardLink("user-123");

      expect(paystack.initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "user@example.com",
          amount: 50,
          metadata: expect.objectContaining({
            customerId: "cust-123",
            type: "CARD_UPDATE",
          }),
        })
      );
      expect(response.link).toBe("https://checkout.paystack.com/card-update-link");
    });
  });

  describe("syncSubscriptionCard", () => {
    it("should fetch default card from DB and return it", async () => {
      mockPrisma.customer.findUnique.mockResolvedValue({ id: "cust-123" });
      mockPrisma.paymentMethod.findFirst.mockResolvedValue({
        id: "pm-123",
        customerId: "cust-123",
        paystackAuthorizationCode: "AUTH_code123",
        isDefault: true,
      });

      const result = await service.syncSubscriptionCard("user-123");

      expect(prisma.paymentMethod.findFirst).toHaveBeenCalledWith({
        where: { customerId: "cust-123", isDefault: true },
      });
      expect(result.id).toBe("pm-123");
    });
  });
});
