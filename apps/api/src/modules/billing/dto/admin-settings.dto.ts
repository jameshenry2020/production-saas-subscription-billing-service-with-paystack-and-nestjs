import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min } from "class-validator";

export class SetFreePlanFlagDto {
  @ApiProperty({
    description: "Set to true to auto-subscribe new users to the Free plan on signup. Set to false to enable free trial mode.",
    example: false,
  })
  @IsBoolean()
  enabled: boolean;
}

export class SetTrialPeriodDto {
  @ApiProperty({
    description: "Number of trial days to apply to this price. Must be between 1 and 365.",
    example: 14,
  })
  @IsInt()
  @Min(1)
  @Max(365)
  trialDays: number;
}

export class UpdateSystemSettingDto {
  @ApiProperty({ description: "The setting key to update", example: "FREE_PLAN_AUTO_SUBSCRIBE" })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ description: "The new value for the setting", example: "true" })
  @IsString()
  @IsNotEmpty()
  value: string;
}
