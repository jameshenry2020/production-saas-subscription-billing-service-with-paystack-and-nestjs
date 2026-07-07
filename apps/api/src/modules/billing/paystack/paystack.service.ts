import { Injectable, HttpStatus, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { PaymentConfiguration } from "../../../config/app-config";
import { PaystackApiException } from "./exceptions/paystack-api.exception";
import {
  PaystackPlan,
  PaystackCustomer,
  PaystackTransactionInit,
  PaystackTransaction,
  PaystackSubscription,
} from "./interfaces/paystack.interfaces";

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(
    private readonly config: PaymentConfiguration,
    private readonly httpService: HttpService
  ) {}

  private handleError(error: any, context: string): never {
    this.logger.error(`Error in [${context}]:`, error.response?.data || error.message);
    if (error.response) {
      const status = error.response.status || HttpStatus.BAD_REQUEST;
      const message = error.response.data?.message || "Paystack API call failed";
      throw new PaystackApiException(message, status, error.response.data);
    }
    throw new PaystackApiException(
      error.message || "Internal server error connecting to Paystack",
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  // --- PLAN METHODS ---

  async createPlan(params: {
    name: string;
    amount: number;
    interval: string;
    currency: string;
    description?: string;
  }): Promise<PaystackPlan> {
    try {
      const response = await firstValueFrom(
        this.httpService.post("/plan", {
          name: params.name,
          amount: params.amount,
          interval: params.interval.toLowerCase(),
          currency: params.currency,
          description: params.description,
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "createPlan");
    }
  }

  async listPlans(params?: { perPage?: number; page?: number }): Promise<PaystackPlan[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get("/plan", {
          params: {
            perPage: params?.perPage || 50,
            page: params?.page || 1,
          },
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "listPlans");
    }
  }

  async fetchPlan(planCode: string): Promise<PaystackPlan> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`/plan/${planCode}`)
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "fetchPlan");
    }
  }

  // --- CUSTOMER METHODS ---

  async createCustomer(params: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    metadata?: any;
  }): Promise<PaystackCustomer> {
    try {
      const response = await firstValueFrom(
        this.httpService.post("/customer", {
          email: params.email,
          first_name: params.firstName,
          last_name: params.lastName,
          phone: params.phone,
          metadata: params.metadata,
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "createCustomer");
    }
  }

  async fetchCustomer(emailOrCode: string): Promise<PaystackCustomer> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`/customer/${emailOrCode}`)
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "fetchCustomer");
    }
  }

  // --- TRANSACTION METHODS ---

  async initializeTransaction(params: {
    email: string;
    amount: number;
    callbackUrl?: string;
    reference?: string;
    plan?: string;
    metadata?: any;
  }): Promise<PaystackTransactionInit> {
    try {
      const response = await firstValueFrom(
        this.httpService.post("/transaction/initialize", {
          email: params.email,
          amount: Math.round(params.amount * 100),
          callback_url: params.callbackUrl,
          reference: params.reference,
          plan: params.plan,
          metadata: params.metadata,
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "initializeTransaction");
    }
  }

  async verifyTransaction(reference: string): Promise<PaystackTransaction> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`/transaction/verify/${reference}`)
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "verifyTransaction");
    }
  }

  async chargeAuthorization(params: {
    email: string;
    amount: number;
    authorizationCode: string;
    reference?: string;
    metadata?: any;
  }): Promise<PaystackTransaction> {
    try {
      const response = await firstValueFrom(
        this.httpService.post("/transaction/charge_authorization", {
          email: params.email,
          amount: Math.round(params.amount * 100),
          authorization_code: params.authorizationCode,
          reference: params.reference,
          metadata: params.metadata,
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "chargeAuthorization");
    }
  }

  // --- SUBSCRIPTION METHODS ---

  async createSubscription(params: {
    customer: string; // Customer email or code
    plan: string; // Plan code
    authorization?: string; // Authorization code (tokenized card)
    startDate?: string; // ISO date string
  }): Promise<PaystackSubscription> {
    try {
      const response = await firstValueFrom(
        this.httpService.post("/subscription", {
          customer: params.customer,
          plan: params.plan,
          authorization: params.authorization,
          start_date: params.startDate,
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "createSubscription");
    }
  }

  async fetchSubscription(subscriptionCode: string): Promise<PaystackSubscription> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`/subscription/${subscriptionCode}`)
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "fetchSubscription");
    }
  }

  async disableSubscription(params: { code: string; token: string }): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post("/subscription/disable", {
          code: params.code,
          token: params.token,
        })
      );
    } catch (error) {
      this.handleError(error, "disableSubscription");
    }
  }

  async enableSubscription(params: { code: string; token: string }): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post("/subscription/enable", {
          code: params.code,
          token: params.token,
        })
      );
    } catch (error) {
      this.handleError(error, "enableSubscription");
    }
  }

  async getSubscriptionManageLink(subscriptionCode: string): Promise<{ link: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`/subscription/${subscriptionCode}/manage/link`)
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "getSubscriptionManageLink");
    }
  }

  async refundTransaction(reference: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.post("/refund", {
          transaction: reference,
        })
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, "refundTransaction");
    }
  }
}

