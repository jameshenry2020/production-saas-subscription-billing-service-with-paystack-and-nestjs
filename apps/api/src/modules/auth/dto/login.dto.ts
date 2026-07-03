import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class LoginDto {
  @ApiProperty({
    description: "The email address of the user",
    example: "john.doe@example.com",
  })
  @IsEmail({}, { message: "Please enter a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email: string;

  @ApiProperty({
    description: "The password of the user",
    example: "supersecurepassword123",
  })
  @IsString()
  @IsNotEmpty({ message: "Password is required" })
  password: string;
}
