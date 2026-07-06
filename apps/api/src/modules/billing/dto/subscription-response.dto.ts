import { ApiProperty } from "@nestjs/swagger";
import { SubscriptionStatus, BillingInterval } from "prisma/generated/prisma/client";

export class SubscriptionResponseDto {
  @ApiProperty({ example: "cuid-sub-123" })
  id: string;

  @ApiProperty({ example: "cuid-cust-456" })
  customerId: string;

  @ApiProperty({ example: "cuid-plan-789" })
  planId: string;

  @ApiProperty({ example: "cuid-price-abc" })
  priceId: string;

  @ApiProperty({ enum: SubscriptionStatus, example: "ACTIVE" })
  status: SubscriptionStatus;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: "2026-07-03T22:00:00Z" })
  currentPeriodStart: Date;

  @ApiProperty({ example: "2026-08-03T22:00:00Z" })
  currentPeriodEnd: Date;

  @ApiProperty({ example: null, required: false })
  trialStart?: Date | null;

  @ApiProperty({ example: null, required: false })
  trialEnd?: Date | null;

  @ApiProperty({ example: false })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ example: "SUB_code123", required: false })
  paystackSubscriptionCode?: string | null;

  @ApiProperty({ example: "2026-07-03T22:00:00Z" })
  createdAt: Date;

  @ApiProperty({ example: "Pro Plan" })
  planName: string;

  @ApiProperty({ example: 1000000 })
  priceAmount: number; // in kobo

  @ApiProperty({ example: "NGN" })
  priceCurrency: string;

  @ApiProperty({ enum: BillingInterval, example: "MONTHLY" })
  priceInterval: BillingInterval;
}
