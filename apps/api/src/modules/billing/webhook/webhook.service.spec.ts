import { Test, TestingModule } from "@nestjs/testing";
import { WebhookService } from "./webhook.service";
import { SubscriptionService } from "../subscription/subscription.service";

describe("WebhookService (Unit)", () => {
  let service: WebhookService;
  let subscriptionService: SubscriptionService;

  const mockSubscriptionService = {
    processSuccessfulPayment: jest.fn(),
    processFailedPayment: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: SubscriptionService, useValue: mockSubscriptionService },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    subscriptionService = module.get<SubscriptionService>(SubscriptionService);

    jest.clearAllMocks();
  });

  describe("handleChargeSuccess", () => {
    it("should process successful charge payment", async () => {
      const payload = {
        reference: "ref-123",
        amount: 5000,
      };

      await service.handleEvent("charge.success", payload);

      expect(subscriptionService.processSuccessfulPayment).toHaveBeenCalledWith(
        "ref-123",
        payload
      );
    });
  });

  describe("handleChargeFailed", () => {
    it("should process failed charge payment", async () => {
      const payload = {
        reference: "ref-123",
        amount: 5000,
        gateway_response: "Declined",
      };

      await service.handleEvent("charge.failed", payload);

      expect(subscriptionService.processFailedPayment).toHaveBeenCalledWith(
        "ref-123",
        payload
      );
    });
  });
});
