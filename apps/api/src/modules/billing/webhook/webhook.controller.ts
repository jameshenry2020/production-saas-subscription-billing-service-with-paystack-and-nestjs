import { Controller, Post, Headers, Req, UnauthorizedException, HttpCode, HttpStatus } from "@nestjs/common";
import { Request } from "express";
import * as crypto from "crypto";
import { PaymentConfiguration } from "../../../config/app-config";
import { WebhookService } from "./webhook.service";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Payment Webhooks")
@Controller("billing/webhook")
export class WebhookController {
  constructor(
    private readonly paymentConfig: PaymentConfiguration,
    private readonly webhookService: WebhookService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Listen to and process Paystack payment webhook events",
    description: "Validates the signature header and dispatches processing for charge, subscription, and invoice state updates.",
  })
  @ApiResponse({ status: 200, description: "Webhook received and verified." })
  @ApiResponse({ status: 401, description: "Invalid Paystack header signature mismatch." })
  async handleWebhook(
    @Req() req: Request,
    @Headers("x-paystack-signature") signature: string
  ) {
    const rawBody = (req as any).rawBody;

    if (!rawBody || !signature) {
      throw new UnauthorizedException("Paystack webhook signature header or request body is missing.");
    }

    // Verify HMAC SHA512 signature using Paystack Secret Key
    const calculatedSignature = crypto
      .createHmac("sha512", this.paymentConfig.paystackSecretKey)
      .update(rawBody)
      .digest("hex");

    if (calculatedSignature !== signature) {
      throw new UnauthorizedException("Paystack webhook signature verification failed.");
    }

    const body = JSON.parse(rawBody.toString("utf8"));
    
    // Process Paystack Event
    await this.webhookService.handleEvent(body.event, body.data);

    return { received: true };
  }
}
