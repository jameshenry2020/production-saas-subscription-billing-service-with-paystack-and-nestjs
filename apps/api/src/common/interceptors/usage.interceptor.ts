import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { UsageService } from "../../modules/billing/usage/usage.service";
import { TRACK_USAGE_KEY, TrackUsageOptions } from "../decorators/track-usage.decorator";

@Injectable()
export class UsageInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly usageService: UsageService
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const options = this.reflector.get<TrackUsageOptions>(
      TRACK_USAGE_KEY,
      context.getHandler()
    );

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException("Authentication session is required to track feature usage.");
    }

    // Automatically check limits and increment usage using userId
    await this.usageService.trackUsageByUserId(
      user.id,
      options.featureKey,
      options.quantity ?? 1
    );

    return next.handle();
  }
}
