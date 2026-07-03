import { BillingInterval } from "prisma/generated/prisma/client";
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsEnum, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PriceInputDto {
  @ApiProperty({
    enum: BillingInterval,
    description: "Billing cycle interval",
    example: BillingInterval.MONTHLY,
  })
  @IsEnum(BillingInterval)
  interval: BillingInterval;

  @ApiPropertyOptional({
    type: Number,
    description: "Number of intervals between billings",
    default: 1,
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  intervalCount?: number = 1;

  @ApiPropertyOptional({
    type: String,
    description: "Three-letter ISO currency code",
    default: "NGN",
    example: "NGN",
  })
  @IsString()
  @IsOptional()
  currency?: string = "NGN";

  @ApiProperty({
    type: Number,
    description: "The price amount in minor units (e.g., kobo for NGN, cents for USD)",
    example: 1000000, // 10,000 NGN
  })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({
    type: Number,
    description: "Number of free trial days for the subscription price plan",
    example: 14,
  })
  @IsNumber()
  @IsOptional()
  trialPeriodDays?: number;
}

export class FeatureInputDto {
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
    description: "The quota/limit of the feature (leave blank or null for unlimited)",
    example: 10,
  })
  @IsNumber()
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is overage usage allowed beyond the feature limit?",
    default: false,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  overageAllowed?: boolean = false;

  @ApiPropertyOptional({
    type: Number,
    description: "Unit price for overage usage in minor units",
    example: 50000, // 500 NGN
  })
  @IsNumber()
  @IsOptional()
  overageUnitPrice?: number;
}

export class CreatePlanDto {
  @ApiPropertyOptional({
    type: String,
    description: "Database UUID of the associated product",
    example: "d3b07384-d113-4ec5-a5d6-d04b7b2586a1",
  })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiProperty({
    type: String,
    description: "The display name of the billing plan",
    example: "Pro Plan",
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    type: String,
    description: "Unique URL-friendly slug for identifying the plan",
    example: "pro",
  })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional({
    type: String,
    description: "Brief descriptive summary of what the plan offers",
    example: "Perfect for growing startup teams",
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is this plan visible publicly on the pricing table?",
    default: true,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean = true;

  @ApiPropertyOptional({
    type: Boolean,
    description: "Is this plan active and currently subscribable?",
    default: true,
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @ApiPropertyOptional({
    type: Number,
    description: "Sequence order for sorting plans in views",
    default: 0,
    example: 1,
  })
  @IsNumber()
  @IsOptional()
  sortOrder?: number = 0;

  @ApiPropertyOptional({
    type: [PriceInputDto],
    description: "Pricing schemes associated with the plan",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceInputDto)
  @IsOptional()
  prices?: PriceInputDto[] = [];

  @ApiPropertyOptional({
    type: [FeatureInputDto],
    description: "Feature limitations configured for this plan",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureInputDto)
  @IsOptional()
  features?: FeatureInputDto[] = [];
}
