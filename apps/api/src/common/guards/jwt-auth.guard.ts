import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserService } from "../../modules/users/user.service";
import { Request } from "express";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.session;
    if (!token) {
      throw new UnauthorizedException("Authentication session token is missing.");
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      
      // Verify that user exists in database and is active
      const user = await this.userService.findById(payload.sub);
      if (!user || !user.isActive) {
        throw new UnauthorizedException("User not found or account is deactivated.");
      }

      // Attach formatted user object to request
      request.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      };

      return true;
    } catch (err) {
      throw new UnauthorizedException("Session is invalid or expired.");
    }
  }
}
