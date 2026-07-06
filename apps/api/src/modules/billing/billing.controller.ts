import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { BillingService } from "./billing.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { PlanResponseDto } from "./dto/plan-response.dto";
import { SetFreePlanFlagDto, SetTrialPeriodDto } from "./dto/admin-settings.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminOnlyGuard } from "../../common/guards/admin-only.guard";
import { RequireAdmin } from "../../common/decorators/require-admin.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Billing & Plans")
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // ── Public Plan Endpoints ─────────────────────────────────────────────────

  @Get("plans")
  @ApiOperation({ summary: "Get all active billing plans", description: "Fetch plans list including prices and feature quotas." })
  @ApiResponse({ status: 200, type: PlanResponseDto, isArray: true, description: "Successfully retrieved plans list" })
  async getPlans(): Promise<PlanResponseDto[]> {
    return this.billingService.getPlans();
  }

  @Get("plans/:idOrSlug")
  @ApiOperation({ summary: "Get a plan by ID or unique slug" })
  @ApiResponse({ status: 200, type: PlanResponseDto, description: "Successfully retrieved plan details" })
  @ApiResponse({ status: 404, description: "Plan not found" })
  async getPlanByIdOrSlug(@Param("idOrSlug") idOrSlug: string): Promise<PlanResponseDto> {
    return this.billingService.getPlanByIdOrSlug(idOrSlug);
  }

  // ── Admin: Plan Management ────────────────────────────────────────────────

  @Post("plans")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @ApiCookieAuth("session")
  @ApiOperation({ summary: "Create a new billing plan", description: "Admin-only. Validates input features and syncs with Paystack." })
  @ApiResponse({ status: 201, type: PlanResponseDto, description: "Plan successfully created and synced" })
  @ApiResponse({ status: 401, description: "Authentication session missing or invalid" })
  @ApiResponse({ status: 403, description: "Admin access required" })
  @HttpCode(HttpStatus.CREATED)
  async createPlan(@Body() createPlanDto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.billingService.createPlan(createPlanDto);
  }

  @Patch("plans/:idOrSlug")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @ApiCookieAuth("session")
  @ApiOperation({ summary: "Update an existing billing plan", description: "Admin-only. Modifies sorting priority, public status, prices, and features." })
  @ApiResponse({ status: 200, type: PlanResponseDto, description: "Plan successfully updated" })
  @ApiResponse({ status: 401, description: "Authentication session missing or invalid" })
  @ApiResponse({ status: 403, description: "Admin access required" })
  @ApiResponse({ status: 404, description: "Plan not found" })
  async updatePlan(
    @Param("idOrSlug") idOrSlug: string,
    @Body() updatePlanDto: UpdatePlanDto
  ): Promise<PlanResponseDto> {
    return this.billingService.updatePlan(idOrSlug, updatePlanDto);
  }

  // ── Admin: System Settings & Feature Flags ────────────────────────────────

  @Get("admin/settings")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Get all system settings",
    description: "Admin-only. Returns all runtime feature flags and system configuration values.",
  })
  @ApiResponse({ status: 200, description: "List of all system settings" })
  @ApiResponse({ status: 403, description: "Admin access required" })
  async getAllSettings() {
    return this.billingService.getAllSettings();
  }

  @Patch("admin/settings/free-plan-flag")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Toggle free plan auto-subscribe feature flag",
    description:
      "Admin-only. When enabled=true, new users are auto-subscribed to the Free plan on signup. " +
      "When enabled=false, only a Customer profile is created and free trial mode becomes active.",
  })
  @ApiResponse({ status: 200, description: "Flag updated successfully" })
  @ApiResponse({ status: 403, description: "Admin access required" })
  async setFreePlanFlag(@CurrentUser() admin: any, @Body() dto: SetFreePlanFlagDto) {
    return this.billingService.setFreePlanFlag(dto.enabled, admin.id);
  }

  // ── Admin: Trial Period Management on Prices ─────────────────────────────

  @Post("admin/prices/:priceId/trial")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Set a free trial period on a price",
    description:
      "Admin-only. Sets the trialPeriodDays on the given Price. " +
      "Only new checkouts for this price will be offered the trial. Existing TRIALING subscriptions are not affected.",
  })
  @ApiResponse({ status: 201, type: PlanResponseDto, description: "Trial set. Returns updated plan." })
  @ApiResponse({ status: 404, description: "Price not found" })
  @ApiResponse({ status: 403, description: "Admin access required" })
  @HttpCode(HttpStatus.CREATED)
  async setTrialOnPrice(
    @Param("priceId") priceId: string,
    @Body() dto: SetTrialPeriodDto
  ): Promise<PlanResponseDto> {
    return this.billingService.setTrialOnPrice(priceId, dto.trialDays);
  }

  @Delete("admin/prices/:priceId/trial")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @ApiCookieAuth("session")
  @ApiOperation({
    summary: "Remove free trial period from a price",
    description:
      "Admin-only. Clears the trialPeriodDays from the given Price (sets to null). " +
      "Existing TRIALING subscriptions are not affected — only future checkouts.",
  })
  @ApiResponse({ status: 200, type: PlanResponseDto, description: "Trial removed. Returns updated plan." })
  @ApiResponse({ status: 404, description: "Price not found" })
  @ApiResponse({ status: 403, description: "Admin access required" })
  async removeTrialOnPrice(@Param("priceId") priceId: string): Promise<PlanResponseDto> {
    return this.billingService.removeTrialOnPrice(priceId);
  }
}