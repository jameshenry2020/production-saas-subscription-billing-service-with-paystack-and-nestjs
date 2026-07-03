import { IsNotEmpty, IsString } from "class-validator";
import { SignupDto } from "./signup.dto";

export class SignupAdminDto extends SignupDto {
  @IsString()
  @IsNotEmpty({ message: "Admin registration secret is required" })
  secret: string;
}
