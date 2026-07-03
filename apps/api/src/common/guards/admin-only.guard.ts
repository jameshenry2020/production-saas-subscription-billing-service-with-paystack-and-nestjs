import { CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { REQUIRE_ADMIN_KEY } from "../decorators/require-admin.decorator";

@Injectable()
export class AdminOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireAdmin = this.reflector.getAllAndOverride<boolean>(REQUIRE_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requireAdmin) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { id: string; email: string; name: string; isAdmin: boolean } | undefined;

    if (!user) {
      throw new UnauthorizedException("Authentication session is required.");
    }

    if (!user.isAdmin) {
      throw new ForbiddenException("Access denied. Admin privileges required.");
    }

    return true;
  }
}
