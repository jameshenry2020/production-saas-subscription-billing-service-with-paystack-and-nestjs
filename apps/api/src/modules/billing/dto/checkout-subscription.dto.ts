import { IsNotEmpty, IsString } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CheckoutSubscriptionDto {
  @ApiProperty({
    description: "The ID of the plan price to subscribe to",
    example: "cuid-price-123",
  })
  @IsString()
  @IsNotEmpty()
  priceId: string;
}

