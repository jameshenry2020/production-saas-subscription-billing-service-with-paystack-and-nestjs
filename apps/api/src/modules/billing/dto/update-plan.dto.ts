import { BillingInterval } from "prisma/generated/prisma/client";
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsEnum, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class UpdatePriceInputDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsEnum(BillingInterval)
  @IsOptional()
  interval?: BillingInterval;

  @IsNumber()
  @IsOptional()
  intervalCount?: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  amount?: number;

  @IsNumber()
  @IsOptional()
  trialPeriodDays?: number | null;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateFeatureInputDto {
  @IsString()
  @IsNotEmpty()
  featureKey: string;

  @IsNumber()
  @IsOptional()
  limit?: number | null;

  @IsBoolean()
  @IsOptional()
  overageAllowed?: boolean;

  @IsNumber()
  @IsOptional()
  overageUnitPrice?: number | null;
}

export class UpdatePlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string | null;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePriceInputDto)
  @IsOptional()
  prices?: UpdatePriceInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateFeatureInputDto)
  @IsOptional()
  features?: UpdateFeatureInputDto[];
}
