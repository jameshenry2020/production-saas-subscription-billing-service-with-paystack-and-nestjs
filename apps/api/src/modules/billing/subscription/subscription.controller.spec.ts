import { Test, TestingModule } from "@nestjs/testing";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "../../users/user.service";
import { PrismaService } from "../../../infrastructure/database/prisma.service";

describe("SubscriptionController (Unit)", () => {
  let controller: SubscriptionController;
  let service: SubscriptionService;

  const mockSubscriptionService = {
    cancelSubscription: jest.fn(),
    generateChangeCardLink: jest.fn(),
    syncSubscriptionCard: jest.fn(),
    reactivateSubscription: jest.fn(),
  };

  const mockJwtService = {};
  const mockUserService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        { provide: SubscriptionService, useValue: mockSubscriptionService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: UserService, useValue: mockUserService },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<SubscriptionController>(SubscriptionController);
    service = module.get<SubscriptionService>(SubscriptionService);

    jest.clearAllMocks();
  });

  describe("cancel", () => {
    it("should call subscriptionService.cancelSubscription with user.id", async () => {
      const user = { id: "user-123" };
      mockSubscriptionService.cancelSubscription.mockResolvedValue({ id: "sub-123" });

      const result = await controller.cancel(user);

      expect(service.cancelSubscription).toHaveBeenCalledWith("user-123");
      expect(result).toEqual({ id: "sub-123" });
    });
  });

  describe("reactivate", () => {
    it("should call subscriptionService.reactivateSubscription with user.id", async () => {
      const user = { id: "user-123" };
      mockSubscriptionService.reactivateSubscription.mockResolvedValue({ id: "sub-123", status: "ACTIVE" });

      const result = await controller.reactivate(user);

      expect(service.reactivateSubscription).toHaveBeenCalledWith("user-123");
      expect(result).toEqual({ id: "sub-123", status: "ACTIVE" });
    });
  });

  describe("getChangeCardLink", () => {
    it("should call subscriptionService.generateChangeCardLink with user.id", async () => {
      const user = { id: "user-123" };
      mockSubscriptionService.generateChangeCardLink.mockResolvedValue({
        link: "https://paystack.com/manage/subscriptions/link",
      });

      const result = await controller.getChangeCardLink(user);

      expect(service.generateChangeCardLink).toHaveBeenCalledWith("user-123");
      expect(result).toEqual({ link: "https://paystack.com/manage/subscriptions/link" });
    });
  });

  describe("syncCard", () => {
    it("should call subscriptionService.syncSubscriptionCard with user.id", async () => {
      const user = { id: "user-123" };
      mockSubscriptionService.syncSubscriptionCard.mockResolvedValue({ id: "pm-123" });

      const result = await controller.syncCard(user);

      expect(service.syncSubscriptionCard).toHaveBeenCalledWith("user-123");
      expect(result).toEqual({ id: "pm-123" });
    });
  });
});
