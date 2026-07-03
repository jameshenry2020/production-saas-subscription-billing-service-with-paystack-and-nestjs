import { Controller, Get, Post, Patch, Body, Param, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { CreatePlanDto } from "./dto/create-plan.dto";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { PlanResponseDto } from "./dto/plan-response.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminOnlyGuard } from "../../common/guards/admin-only.guard";
import { RequireAdmin } from "../../common/decorators/require-admin.decorator";

@Controller("billing")
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("plans")
  async getPlans(): Promise<PlanResponseDto[]> {
    return this.billingService.getPlans();
  }

  @Get("plans/:idOrSlug")
  async getPlanByIdOrSlug(@Param("idOrSlug") idOrSlug: string): Promise<PlanResponseDto> {
    return this.billingService.getPlanByIdOrSlug(idOrSlug);
  }

  @Post("plans")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  @HttpCode(HttpStatus.CREATED)
  async createPlan(@Body() createPlanDto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.billingService.createPlan(createPlanDto);
  }

  @Patch("plans/:idOrSlug")
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  @RequireAdmin()
  async updatePlan(
    @Param("idOrSlug") idOrSlug: string,
    @Body() updatePlanDto: UpdatePlanDto
  ): Promise<PlanResponseDto> {
    return this.billingService.updatePlan(idOrSlug, updatePlanDto);
  }
}