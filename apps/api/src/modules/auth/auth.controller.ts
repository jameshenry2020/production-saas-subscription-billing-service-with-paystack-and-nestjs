import { Controller, Post, Body, Res, HttpCode, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { SignupAdminDto } from "./dto/signup-admin.dto";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setSessionCookie(res: Response, token: string) {
    res.cookie("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 1 day in milliseconds
    });
  }

  @Post("signup")
  @ApiOperation({ summary: "Register a new standard user", description: "Registers a user and sets the session cookie." })
  @ApiResponse({ status: 201, description: "User successfully registered and logged in" })
  @ApiResponse({ status: 400, description: "Email already exists or validation failed" })
  @HttpCode(HttpStatus.CREATED)
  async signup(
    @Body() signupDto: SignupDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.signup(signupDto);
    this.setSessionCookie(res, result.accessToken);
    return { user: result.user };
  }

  @Post("admin/signup")
  @ApiOperation({ summary: "Register a new admin user", description: "Registers an admin user using a registration secret." })
  @ApiResponse({ status: 201, description: "Admin user successfully registered and logged in" })
  @ApiResponse({ status: 401, description: "Invalid admin registration secret" })
  @ApiResponse({ status: 400, description: "Email already exists or validation failed" })
  @HttpCode(HttpStatus.CREATED)
  async signupAdmin(
    @Body() signupAdminDto: SignupAdminDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.signupAdmin(signupAdminDto);
    this.setSessionCookie(res, result.accessToken);
    return { user: result.user };
  }

  @Post("login")
  @ApiOperation({ summary: "Log in with email and password", description: "Authenticates a user and sets the session cookie." })
  @ApiResponse({ status: 200, description: "Successful login" })
  @ApiResponse({ status: 401, description: "Invalid email or password" })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.login(loginDto);
    this.setSessionCookie(res, result.accessToken);
    return { user: result.user };
  }

  @Post("logout")
  @ApiOperation({ summary: "Log out user session", description: "Clears the active session cookie." })
  @ApiResponse({ status: 200, description: "Successful logout" })
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie("session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    return { message: "Logged out successfully" };
  }
}