import { Controller, Post, Get, Body, Param, UseGuards, Headers, BadRequestException } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import { CheckoutSubscriptionDto } from "../dto/checkout-subscription.dto";
import { SubscriptionResponseDto } from "../dto/subscription-response.dto";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Subscription Management")
@Controller("billing/subscription")
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post("checkout")
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Initialize plan subscription or change checkouts",
    description: "Handles upgrades, downgrades, and initial checkouts. Returns a Paystack payment authorization URL or the subscription.",
  })
  @ApiResponse({ status: 201, description: "Successfully initialized subscription flow." })
  @ApiResponse({ status: 400, description: "Invalid plan transition or validation failure." })
  @ApiResponse({ status: 409, description: "Concurrent request conflict." })
  async checkout(
    @CurrentUser() user: any,
    @Headers() headers: Record<string, string>,
    @Body() dto: CheckoutSubscriptionDto
  ): Promise<any> {
    const idempotencyKey = headers["x-idempotency-key"] || headers["idempotency-key"];
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency key header (x-idempotency-key) is required.");
    }
    return this.subscriptionService.initializeCheckout(user.id, dto, idempotencyKey);
  }


  @Get("verify/:reference")
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Synchronously verify a payment reference status",
    description: "Queries Paystack to confirm transaction outcome and triggers internal database state synchronization.",
  })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto, description: "Payment verified and database synced." })
  @ApiResponse({ status: 404, description: "Transaction reference not found." })
  async verify(
    @CurrentUser() user: any,
    @Param("reference") reference: string
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionService.verifyAndSyncPayment(user.id, reference);
  }

  @Post("cancel")
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Cancel subscription at period end",
    description: "Sets the subscription to stop renewing at the end of the current billing cycle.",
  })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto, description: "Subscription set to cancel." })
  async cancel(@CurrentUser() user: any): Promise<SubscriptionResponseDto> {
    return this.subscriptionService.cancelSubscription(user.id);
  }

  @Post("change-card-link")
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Generate a card details update link",
    description: "Generates a Paystack hosted link for the user to update their card authorization details.",
  })
  @ApiResponse({ status: 200, description: "Successfully generated link." })
  async getChangeCardLink(@CurrentUser() user: any): Promise<{ link: string }> {
    return this.subscriptionService.generateChangeCardLink(user.id);
  }

  @Post("sync-card")
  @UseGuards(JwtAuthGuard)
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Synchronize card details from Paystack",
    description: "Fetches subscription details from Paystack and updates the local payment method registry.",
  })
  @ApiResponse({ status: 200, description: "Card details successfully synchronized." })
  async syncCard(@CurrentUser() user: any): Promise<any> {
    return this.subscriptionService.syncSubscriptionCard(user.id);
  }
}