import { SubscriptionResponseDto } from "../dto/subscription-response.dto";

export class SubscriptionMapper {
  static toSubscriptionResponse(sub: any): SubscriptionResponseDto {
    return {
      id: sub.id,
      customerId: sub.customerId,
      planId: sub.planId,
      priceId: sub.priceId,
      status: sub.status,
      quantity: sub.quantity,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      trialStart: sub.trialStart,
      trialEnd: sub.trialEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      paystackSubscriptionCode: sub.paystackSubscriptionCode,
      createdAt: sub.createdAt,
      planName: sub.plan?.name || "Unknown Plan",
      priceAmount: sub.price?.amount ?? 0,
      priceCurrency: sub.price?.currency || "NGN",
      priceInterval: sub.price?.interval || "MONTHLY",
    };
  }
}
