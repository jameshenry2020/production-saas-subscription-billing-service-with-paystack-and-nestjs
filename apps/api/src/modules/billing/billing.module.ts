import { Module, forwardRef } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { PaystackService } from "./paystack/paystack.service";
import { AuthModule } from "../auth/auth.module";
import { UserModule } from "../users/user.module";
import { PaymentConfiguration } from "../../config/app-config";
import { SystemSettingModule } from "../../infrastructure/settings/system-setting.module";

@Module({
  imports: [
    forwardRef(() => AuthModule),
    UserModule,
    SystemSettingModule,
    HttpModule.registerAsync({
      inject: [PaymentConfiguration],
      useFactory: (config: PaymentConfiguration) => ({
        baseURL: "https://api.paystack.co",
        headers: {
          Authorization: `Bearer ${config.paystackSecretKey}`,
          "Content-Type": "application/json",
        },
      }),
    }),
  ],
  controllers: [BillingController],
  providers: [BillingService, PaystackService],
  exports: [BillingService, PaystackService],
})
export class BillingModule {}