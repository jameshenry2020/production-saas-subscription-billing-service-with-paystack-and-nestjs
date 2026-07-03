import { PlanResponseDto, PriceResponseDto, FeatureResponseDto } from "../dto/plan-response.dto";

export class BillingMapper {
  static toPlanResponse(plan: any): PlanResponseDto {
    const prices: PriceResponseDto[] = (plan.prices || []).map((price: any) => ({
      id: price.id,
      interval: price.interval,
      intervalCount: price.intervalCount,
      currency: price.currency,
      amount: price.amount,
      trialPeriodDays: price.trialPeriodDays,
      paystackPlanCode: price.paystackPlanCode,
    }));

    const features: FeatureResponseDto[] = (plan.planFeatures || []).map((pf: any) => ({
      id: pf.feature.id,
      key: pf.feature.key,
      name: pf.feature.name,
      type: pf.feature.type,
      unit: pf.feature.unit,
      limit: pf.limit,
      overageAllowed: pf.overageAllowed,
      overageUnitPrice: pf.overageUnitPrice,
    }));

    return {
      id: plan.id,
      productId: plan.productId,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      isActive: plan.isActive,
      isPublic: plan.isPublic,
      sortOrder: plan.sortOrder,
      prices,
      features,
    };
  }
}
