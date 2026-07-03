import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { PlanResponseDto } from "./dto/plan-response.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminOnlyGuard } from "../../common/guards/admin-only.guard";
import { RequireAdmin } from "../../common/decorators/require-admin.decorator";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Billing & Plans")
@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

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
}