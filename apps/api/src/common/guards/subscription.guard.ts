import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { SubscriptionStatus } from "prisma/generated/prisma/client";

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException("Authentication is required to access this resource.");
    }

    const customer = await this.prisma.customer.findUnique({
      where: { userId: user.id },
    });

    if (!customer) {
      throw new ForbiddenException("Customer profile not found.");
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });

    if (!subscription) {
      throw new ForbiddenException("No active subscription found.");
    }

    const allowedStatuses: SubscriptionStatus[] = [
      SubscriptionStatus.ACTIVE,
      SubscriptionStatus.TRIALING,
      SubscriptionStatus.PAST_DUE,
    ];

    if (!allowedStatuses.includes(subscription.status)) {
      throw new ForbiddenException(
        `Access denied. Your subscription is currently ${subscription.status.toLowerCase()}.`
      );
    }

    return true;
  }
}
