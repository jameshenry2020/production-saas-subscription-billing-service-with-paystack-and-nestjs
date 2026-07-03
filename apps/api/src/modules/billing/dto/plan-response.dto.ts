import { BillingInterval, FeatureType } from "prisma/generated/prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PriceResponseDto {
  @ApiProperty({
    type: String,
    description: "Database UUID of the price record",
    example: "p1-uuid",
  })
  id: string;

  @ApiProperty({
    enum: BillingInterval,
    description: "Billing interval",
    example: BillingInterval.MONTHLY,
  })
  interval: BillingInterval;

  @ApiProperty({
    type: Number,
    description: "Interval count multiplier",
    example: 1,
  })
  intervalCount: number;

  @ApiProperty({
    type: String,
    description: "ISO currency code",
    example: "NGN",
  })
  currency: string;

  @ApiProperty({
    type: Number,
    description: "Price amount in minor units",
    example: 1000000,
  })
  amount: number;

  @ApiPropertyOptional({
    type: Number,
    description: "Trial period days if configured",
    example: 14,
    nullable: true,
  })
  trialPeriodDays: number | null;

  @ApiPropertyOptional({
    type: String,
    description: "Associated Paystack plan code",
    example: "PLN_12345abcdef",
    nullable: true,
  })
  paystackPlanCode: string | null;
}

export class FeatureResponseDto {
  @ApiProperty({
    type: String,
    description: "Database UUID of the plan-feature config record",
    example: "pf-uuid",
  })
  id: string;

  @ApiProperty({
    type: String,
    description: "Lookup key identifying the feature",
    example: "users",
  })
  key: string;

  @ApiProperty({
    type: String,
    description: "Display name of the feature",
    example: "User Seats",
  })
  name: string;

  @ApiProperty({
    enum: FeatureType,
    description: "Type of feature limit / metering",
    example: FeatureType.LIMIT,
  })
  type: FeatureType;

  @ApiPropertyOptional({
    type: String,
    description: "Measurement unit of feature consumption",
    example: "seat",
    nullable: true,
  })
  unit: string | null;

  @ApiPropertyOptional({
    type: Number,
    description: "Allowed usage quota (null if unlimited)",
    example: 5,
    nullable: true,
  })
  limit: number | null;

  @ApiProperty({
    type: Boolean,
    description: "Are overages allowed for this feature?",
    example: true,
  })
  overageAllowed: boolean;

  @ApiPropertyOptional({
    type: Number,
    description: "Cost per overage unit in minor units",
    example: 150000,
    nullable: true,
  })
  overageUnitPrice: number | null;
}

export class PlanResponseDto {
  @ApiProperty({
    type: String,
    description: "Database UUID of the billing plan",
    example: "plan-uuid-12345",
  })
  id: string;

  @ApiProperty({
    type: String,
    description: "Product UUID associated with the plan",
    example: "prod-uuid-12345",
  })
  productId: string;

  @ApiProperty({
    type: String,
    description: "Display name of the plan",
    example: "Pro Plan",
  })
  name: string;

  @ApiProperty({
    type: String,
    description: "Unique URL-friendly slug",
    example: "pro",
  })
  slug: string;

  @ApiPropertyOptional({
    type: String,
    description: "Short details of the plan description",
    example: "Standard startup pricing tier",
    nullable: true,
  })
  description: string | null;

  @ApiProperty({
    type: Boolean,
    description: "Is this plan active and subscribable?",
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    type: Boolean,
    description: "Is this plan publicly visible?",
    example: true,
  })
  isPublic: boolean;

  @ApiProperty({
    type: Number,
    description: "Sort priority in list views",
    example: 1,
  })
  sortOrder: number;

  @ApiProperty({
    type: [PriceResponseDto],
    description: "Associated pricing options for the plan",
  })
  prices: PriceResponseDto[];

  @ApiProperty({
    type: [FeatureResponseDto],
    description: "Limitations and metering rules for the plan features",
  })
  features: FeatureResponseDto[];
}
