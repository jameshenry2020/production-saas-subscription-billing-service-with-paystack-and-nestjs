import { Controller, Post, Get, Body, Param, UseGuards, BadRequestException, NotFoundException } from "@nestjs/common";
import { UsageService } from "./usage.service";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { SubscriptionGuard } from "../../../common/guards/subscription.guard";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../../infrastructure/database/prisma.service";

class TrackUsageDto {
  featureKey: string;
  quantity: number;
  idempotencyKey?: string;
}

class ToggleOverageDto {
  featureKey: string;
  enabled: boolean;
}

@ApiTags("Usage Tracking")
@Controller("billing/usage")
@UseGuards(JwtAuthGuard, SubscriptionGuard)
@ApiCookieAuth("session")
export class UsageController {
  constructor(
    private readonly usageService: UsageService,
    private readonly prisma: PrismaService
  ) {}

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
    });
    if (!customer) {
      throw new NotFoundException("Customer profile not found for the current user.");
    }
    return customer.id;
  }

  @Post("track")
  @ApiOperation({
    summary: "Track usage event for a feature",
    description: "Logs a feature usage transaction, validating against the active limit and overage configuration.",
  })
  @ApiResponse({ status: 200, description: "Usage logged successfully." })
  @ApiResponse({ status: 403, description: "Quota limit exceeded and overage is inactive." })
  async trackUsage(@CurrentUser() user: any, @Body() dto: TrackUsageDto): Promise<any> {
    if (!dto.featureKey || dto.quantity <= 0) {
      throw new BadRequestException("featureKey is required and quantity must be greater than 0.");
    }
    const customerId = await this.getCustomerId(user.id);
    const success = await this.usageService.trackUsage(
      customerId,
      dto.featureKey,
      dto.quantity,
      dto.idempotencyKey
    );
    return { success };
  }

  @Get("summary/:featureKey")
  @ApiOperation({
    summary: "Get current billing cycle usage summary for a feature",
  })
  @ApiResponse({ status: 200, description: "Returned usage stats." })
  async getUsageSummary(@CurrentUser() user: any, @Param("featureKey") featureKey: string): Promise<any> {
    const customerId = await this.getCustomerId(user.id);
    return this.usageService.checkUsage(customerId, featureKey);
  }

  @Post("overage/toggle")
  @ApiOperation({
    summary: "Toggle overage billing activation for a feature",
    description: "Opt-in or opt-out of overage billing for features where overages are allowed by the active plan.",
  })
  @ApiResponse({ status: 200, description: "Overage toggle updated successfully." })
  async toggleOverage(@CurrentUser() user: any, @Body() dto: ToggleOverageDto): Promise<any> {
    if (!dto.featureKey) {
      throw new BadRequestException("featureKey is required.");
    }
    const customerId = await this.getCustomerId(user.id);
    return this.usageService.toggleOverage(customerId, dto.featureKey, dto.enabled);
  }

  @Post("test/api-call")
  @ApiOperation({
    summary: "Simulate a feature action consuming API Call (metered)",
    description: "Tracks usage of 1 api_calls unit. Protected by SubscriptionGuard.",
  })
  @ApiResponse({ status: 200, description: "Successfully tracked api_call." })
  @ApiResponse({ status: 403, description: "Quota limit exceeded and overage is inactive." })
  async testApiCall(@CurrentUser() user: any): Promise<any> {
    const success = await this.usageService.trackUsageByUserId(user.id, "api_calls", 1);
    return { success, message: "API call simulated successfully." };
  }

  @Post("test/add-seat")
  @ApiOperation({
    summary: "Simulate a feature action consuming User Seat (limit)",
    description: "Tracks usage of 1 users (seats) unit. Protected by SubscriptionGuard.",
  })
  @ApiResponse({ status: 200, description: "Successfully tracked seat." })
  @ApiResponse({ status: 403, description: "Quota limit exceeded." })
  async testAddSeat(@CurrentUser() user: any): Promise<any> {
    const success = await this.usageService.trackUsageByUserId(user.id, "users", 1);
    return { success, message: "User seat added/simulated successfully." };
  }
}
