export interface PaystackPlan {
  id: number;
  name: string;
  plan_code: string;
  description: string | null;
  amount: number; // in kobo
  interval: string; // hourly, daily, weekly, monthly, quarterly, biannually, annually
  currency: string;
  send_invoices: boolean;
  send_sms: boolean;
  hosted_page: boolean;
  hosted_page_url: string | null;
  hosted_page_summary: string | null;
  integration: number;
  domain: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaystackCustomer {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  customer_code: string;
  phone: string | null;
  metadata: any;
  domain: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaystackTransactionInit {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackAuthorization {
  authorization_code: string;
  bin: string;
  last4: string;
  exp_month: string;
  exp_year: string;
  channel: string;
  card_type: string;
  bank: string;
  brand: string;
  reusable: boolean;
  signature: string;
  account_name: string | null;
}

export interface PaystackTransaction {
  id: number;
  domain: string;
  status: string; // success, failed, abandoned, ongoing
  reference: string;
  amount: number; // in kobo
  message: string | null;
  gateway_response: string;
  paid_at: string | null;
  created_at: string;
  channel: string;
  currency: string;
  ip_address: string | null;
  metadata: any;
  customer: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string;
    customer_code: string;
  };
  authorization?: PaystackAuthorization;
}

export interface PaystackSubscription {
  id: number;
  customer: {
    id: number;
    customer_code: string;
    email: string;
  };
  plan: {
    id: number;
    name: string;
    plan_code: string;
    description: string | null;
    amount: number;
    interval: string;
    currency: string;
  };
  integration: number;
  domain: string;
  start: number;
  status: string; // active, non-renewing, attention, completed, cancelled
  subscription_code: string;
  email_token: string;
  amount: number;
  cron_expression: string;
  next_payment_date: string;
  open_invoice: string | null;
  createdAt: string;
  updatedAt: string;
}
