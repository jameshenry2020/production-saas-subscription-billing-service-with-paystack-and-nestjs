import { Injectable, BadRequestException, UnauthorizedException, Inject, forwardRef, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { UserService } from "../users/user.service";
import { SubscriptionService } from "../billing/subscription/subscription.service";
import { SystemSettingService } from "../../infrastructure/settings/system-setting.service";
import { SignupDto } from "./dto/signup.dto";
import { LoginDto } from "./dto/login.dto";
import { SignupAdminDto } from "./dto/signup-admin.dto";
import { AdminConfiguration } from "../../config/app-config";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly adminConfig: AdminConfiguration,
    private readonly systemSetting: SystemSettingService,
    @Inject(forwardRef(() => SubscriptionService))
    private readonly subscriptionService: SubscriptionService
  ) { }

  async signup(dto: SignupDto) {
    // Check if user already exists
    const existingUser = await this.userService.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException("A user with this email address already exists.");
    }

    // Hash the password
    const passwordHash = await argon2.hash(dto.password);

    // Create the user
    const user = await this.userService.createUser(dto.email, passwordHash, dto.name);

    // ── Feature Flag: FREE_PLAN_AUTO_SUBSCRIBE ──────────────────────────────
    // When ON  (default): auto-subscribe the new user to the Free plan.
    // When OFF (trial mode): create a Customer profile only — no subscription.
    //   The trial is offered on first checkout when FREE_PLAN_AUTO_SUBSCRIBE is OFF.
    const freePlanEnabled = await this.systemSetting.getFlag("FREE_PLAN_AUTO_SUBSCRIBE", true);

    if (freePlanEnabled) {
      try {
        await this.subscriptionService.createCustomerAndSubscribeToFree(user.id, user.email, user.name);
      } catch (err: any) {
        // Non-blocking: user is registered regardless. Sync happens on first billing dashboard visit.
        this.logger.error(`No free subscription created for user ${user.id}: ${err.message}`);
      }
    } else {
      // Trial mode: create Paystack customer and local Customer record only
      try {
        await this.subscriptionService.createCustomerOnly(user.id, user.email, user.name);
      } catch (err: any) {
        this.logger.error(`Failed to create customer profile for user ${user.id}: ${err.message}`);
      }
    }

    // Generate JWT access token
    const accessToken = this.generateToken({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      },
    };
  }

  async signupAdmin(dto: SignupAdminDto) {
    // 1. Verify the admin registration secret
    if (dto.secret !== this.adminConfig.registrationSecret) {
      throw new UnauthorizedException("Invalid admin registration secret.");
    }

    // 2. Check if user already exists
    const existingUser = await this.userService.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException("A user with this email address already exists.");
    }

    // 3. Hash the password
    const passwordHash = await argon2.hash(dto.password);

    // 4. Create the admin user
    const user = await this.userService.createAdminUser(dto.email, passwordHash, dto.name);

    // 5. Generate JWT access token
    const accessToken = this.generateToken({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      },
    };
  }

  async login(dto: LoginDto) {
    // Find the user
    const user = await this.userService.findByEmail(dto.email);
    if (!user || !user.password) {
      throw new UnauthorizedException("Invalid email address or password.");
    }

    // Verify the password
    const isPasswordValid = await argon2.verify(user.password, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email address or password.");
    }

    // Update last login
    await this.userService.updateLastLogin(user.id);

    // Generate JWT access token
    const accessToken = this.generateToken({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      },
    };
  }

  private generateToken(user: { id: string; email: string; isAdmin: boolean }): string {
    const payload = {
      sub: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
    };
    return this.jwtService.sign(payload);
  }
}