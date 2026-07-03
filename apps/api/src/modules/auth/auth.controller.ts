import { Controller, Post, Body, Res, HttpCode, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { SignupAdminDto } from "./dto/signup-admin.dto";

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