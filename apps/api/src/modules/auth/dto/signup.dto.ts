import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, MinLength } from "class-validator";

export class SignupDto {
  @ApiProperty({
    description: "The unique email address of the user",
    example: "john.doe@example.com",
  })
  @IsEmail({}, { message: "Please enter a valid email address" })
  @IsNotEmpty({ message: "Email is required" })
  email: string;

  @ApiProperty({
    description: "The password for the account (minimum 8 characters)",
    example: "supersecurepassword123",
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty({ message: "Password is required" })
  @MinLength(8, { message: "Password must be at least 8 characters long" })
  password: string;

  @ApiProperty({
    description: "The full name of the user",
    example: "John Doe",
  })
  @IsString()
  @IsNotEmpty({ message: "Name is required" })
  name: string;
}
