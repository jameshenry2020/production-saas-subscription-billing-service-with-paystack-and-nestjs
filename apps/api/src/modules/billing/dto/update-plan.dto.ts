import { BillingInterval } from "prisma/generated/prisma/client";
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsEnum, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class UpdatePriceInputDto {
  @ApiPropertyOptional({
    type: String,
    description: "Database UUID of the price record if updating an existing one",
    example: "c4b07384-d113-4ec5-a5d6-d04b7b2586a1",
  })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiPropertyOptional({
    enum: BillingInterval,
    description: "Billing cycle interval",
    example: BillingInterval.MONTHLY,
  })
  @IsEnum(BillingInterval)
  @IsOptional()
  interval?: BillingInterval;

  @ApiPropertyOptional({
    type: Number,
    description: "Number of intervals between billings",
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  intervalCount?: number;

  @ApiPropertyOptional({
    type: String,
    description: "Three-letter ISO currency code",
    example: "NGN",
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    type: Number,
    description: "Price amount in minor units",
    example: 1200000,
  })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({
    type: Number,
    description: "Number of free trial days (set to null to remove trial)",
    example: 14,
  })
  @IsNumber()
  @IsOptional()
  trialPeriodDays?: number | null;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is this price scheme active?",
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateFeatureInputDto {
  @ApiProperty({
    type: String,
    description: "The unique lookup key of the feature",
    example: "users",
  })
  @IsString()
  @IsNotEmpty()
  featureKey: string;

  @ApiPropertyOptional({
    type: Number,
    description: "Quota limit of the feature (set to null for unlimited)",
    example: 25,
  })
  @IsNumber()
  @IsOptional()
  limit?: number | null;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is overage usage allowed beyond the feature limit?",
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  overageAllowed?: boolean;

  @ApiPropertyOptional({
    type: Number,
    description: "Unit price for overage usage in minor units (set to null to remove overage pricing)",
    example: 45000,
  })
  @IsNumber()
  @IsOptional()
  overageUnitPrice?: number | null;
}

export class UpdatePlanDto {
  @ApiPropertyOptional({
    type: String,
    description: "The display name of the billing plan",
    example: "Enterprise Pro Plan",
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    type: String,
    description: "Unique URL-friendly slug for identifying the plan",
    example: "enterprise-pro",
  })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiPropertyOptional({
    type: String,
    description: "Brief descriptive summary of what the plan offers (set to null to remove)",
    example: "Advanced features for scale",
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is this plan visible publicly on the pricing table?",
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is this plan active and currently subscribable?",
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: Number,
    description: "Sequence order for sorting plans in views",
    example: 2,
  })
  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [UpdatePriceInputDto],
    description: "Pricing schemes associated with the plan to create or update",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePriceInputDto)
  @IsOptional()
  prices?: UpdatePriceInputDto[];

  @ApiPropertyOptional({
    type: [UpdateFeatureInputDto],
    description: "Feature limitations configured for this plan to create or update",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateFeatureInputDto)
  @IsOptional()
  features?: UpdateFeatureInputDto[];
}
