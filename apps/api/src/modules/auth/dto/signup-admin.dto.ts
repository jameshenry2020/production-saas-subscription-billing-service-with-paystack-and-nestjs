import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import { SignupDto } from "./signup.dto";

export class SignupAdminDto extends SignupDto {
  @ApiProperty({
    description: "The secret passphrase required to authorize admin registration",
    example: "local-dev-admin-secret-key-change-in-production",
  })
  @IsString()
  @IsNotEmpty({ message: "Admin registration secret is required" })
  secret: string;
}
