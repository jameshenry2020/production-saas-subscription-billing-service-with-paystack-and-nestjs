import { BillingInterval } from "prisma/generated/prisma/client";
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsEnum, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class PriceInputDto {
  @IsEnum(BillingInterval)
  interval: BillingInterval;

  @IsNumber()
  @IsOptional()
  intervalCount?: number = 1;

  @IsString()
  @IsOptional()
  currency?: string = "NGN";

  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsNumber()
  @IsOptional()
  trialPeriodDays?: number;
}

export class FeatureInputDto {
  @IsString()
  @IsNotEmpty()
  featureKey: string;

  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsBoolean()
  @IsOptional()
  overageAllowed?: boolean = false;

  @IsNumber()
  @IsOptional()
  overageUnitPrice?: number;
}

export class CreatePlanDto {
  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean = true;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean = true;

  @IsNumber()
  @IsOptional()
  sortOrder?: number = 0;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceInputDto)
  @IsOptional()
  prices?: PriceInputDto[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureInputDto)
  @IsOptional()
  features?: FeatureInputDto[] = [];
}
