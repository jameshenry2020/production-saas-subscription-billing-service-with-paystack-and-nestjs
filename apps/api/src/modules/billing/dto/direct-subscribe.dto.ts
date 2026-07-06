import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class DirectSubscribeDto {
  @ApiProperty({
    description: "The ID of the plan price to subscribe to",
    example: "cuid-price-123",
  })
  @IsString()
  @IsNotEmpty()
  priceId: string;

  @ApiProperty({
    description: "Optional saved payment method ID to charge. If omitted, uses default payment method.",
    required: false,
    example: "cuid-pm-456",
  })
  @IsString()
  @IsOptional()
  paymentMethodId?: string;

  @ApiProperty({
    description: "Optional idempotency key to prevent duplicate subscription creation",
    required: false,
  })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
