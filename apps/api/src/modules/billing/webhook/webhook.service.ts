import { Injectable, Logger } from "@nestjs/common";
import { SubscriptionService } from "../subscription/subscription.service";

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly subscriptionService: SubscriptionService
  ) {}

  async handleEvent(event: string, data: any): Promise<void> {
    this.logger.log(`Handling Paystack webhook event: ${event}`);

    switch (event) {
      case "charge.success":
        await this.handleChargeSuccess(data);
        break;
      case "charge.failed":
        await this.handleChargeFailed(data);
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
   * Fired when a payment fails.
   */
  private async handleChargeFailed(data: any): Promise<void> {
    const reference = data.reference;
    this.logger.log(`Processing failed charge. Reference: ${reference}`);

    try {
      await this.subscriptionService.processFailedPayment(reference, data);
      this.logger.log(`Successfully processed charge.failed updates for reference: ${reference}`);
    } catch (error: any) {
      this.logger.error(`Error processing charge.failed webhook for reference ${reference}: ${error.message}`, error.stack);
    }
  }
}
