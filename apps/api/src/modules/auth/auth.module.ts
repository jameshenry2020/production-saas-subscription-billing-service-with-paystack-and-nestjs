import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserModule } from "../users/user.module";
import { JwtConfiguration } from "../../config/app-config";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";

@Module({
  imports: [
    UserModule,
    JwtModule.registerAsync({
      inject: [JwtConfiguration],
      useFactory: (jwtConfig: JwtConfiguration) => ({
        secret: jwtConfig.secret,
        signOptions: {
          expiresIn: jwtConfig.expiresIn as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule {}