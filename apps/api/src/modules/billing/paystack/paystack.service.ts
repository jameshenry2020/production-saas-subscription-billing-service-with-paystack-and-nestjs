import { Injectable, HttpStatus, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
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
  private readonly client: AxiosInstance;
  private readonly logger = new Logger(PaystackService.name);

  constructor(private readonly config: PaymentConfiguration) {
    this.client = axios.create({
      baseURL: "https://api.paystack.co",
      headers: {
        Authorization: `Bearer ${this.config.paystackSecretKey}`,
        "Content-Type": "application/json",
      },
    });
  }

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
      const response = await this.client.post("/plan", {
        name: params.name,
        amount: params.amount,
        interval: params.interval.toLowerCase(),
        currency: params.currency,
        description: params.description,
      });
      return response.data.data;
    } catch (error) {
      this.handleError(error, "createPlan");
    }
  }

  async listPlans(params?: { perPage?: number; page?: number }): Promise<PaystackPlan[]> {
    try {
      const response = await this.client.get("/plan", {
        params: {
          perPage: params?.perPage || 50,
          page: params?.page || 1,
        },
      });
      return response.data.data;
    } catch (error) {
      this.handleError(error, "listPlans");
    }
  }

  async fetchPlan(planCode: string): Promise<PaystackPlan> {
    try {
      const response = await this.client.get(`/plan/${planCode}`);
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
      const response = await this.client.post("/customer", {
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        phone: params.phone,
        metadata: params.metadata,
      });
      return response.data.data;
    } catch (error) {
      this.handleError(error, "createCustomer");
    }
  }

  async fetchCustomer(emailOrCode: string): Promise<PaystackCustomer> {
    try {
      const response = await this.client.get(`/customer/${emailOrCode}`);
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
      const response = await this.client.post("/transaction/initialize", {
        email: params.email,
        amount: params.amount,
        callback_url: params.callbackUrl,
        reference: params.reference,
        plan: params.plan,
        metadata: params.metadata,
      });
      return response.data.data;
    } catch (error) {
      this.handleError(error, "initializeTransaction");
    }
  }

  async verifyTransaction(reference: string): Promise<PaystackTransaction> {
    try {
      const response = await this.client.get(`/transaction/verify/${reference}`);
      return response.data.data;
    } catch (error) {
      this.handleError(error, "verifyTransaction");
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
      const response = await this.client.post("/subscription", {
        customer: params.customer,
        plan: params.plan,
        authorization: params.authorization,
        start_date: params.startDate,
      });
      return response.data.data;
    } catch (error) {
      this.handleError(error, "createSubscription");
    }
  }

  async fetchSubscription(subscriptionCode: string): Promise<PaystackSubscription> {
    try {
      const response = await this.client.get(`/subscription/${subscriptionCode}`);
      return response.data.data;
    } catch (error) {
      this.handleError(error, "fetchSubscription");
    }
  }

  async disableSubscription(params: { code: string; token: string }): Promise<void> {
    try {
      await this.client.post("/subscription/disable", {
        code: params.code,
        token: params.token,
      });
    } catch (error) {
      this.handleError(error, "disableSubscription");
    }
  }

  async enableSubscription(params: { code: string; token: string }): Promise<void> {
    try {
      await this.client.post("/subscription/enable", {
        code: params.code,
        token: params.token,
      });
    } catch (error) {
      this.handleError(error, "enableSubscription");
    }
  }
}
