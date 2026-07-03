import { BillingInterval, FeatureType } from "prisma/generated/prisma/client";

export class PriceResponseDto {
  id: string;
  interval: BillingInterval;
  intervalCount: number;
  currency: string;
  amount: number;
  trialPeriodDays: number | null;
  paystackPlanCode: string | null;
}

export class FeatureResponseDto {
  id: string;
  key: string;
  name: string;
  type: FeatureType;
  unit: string | null;
  limit: number | null;
  overageAllowed: boolean;
  overageUnitPrice: number | null;
}

export class PlanResponseDto {
  id: string;
  productId: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  prices: PriceResponseDto[];
  features: FeatureResponseDto[];
}
