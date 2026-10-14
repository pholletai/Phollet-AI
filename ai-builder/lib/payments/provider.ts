import { createHmac } from "node:crypto";
import type { PlanId } from "@/lib/payments/plans";

export type PaymentOrder = {
  id: string;
  tranId: string;
  amount: string;
  planId: PlanId;
  userId: string;
};

export type CheckoutDetails = {
  provider: "aba_payway";
  qrImage: string;
  qrString: string;
  expiresAt: string;
};

export type VerifiedPayment =
  | { state: "pending" }
  | { state: "declined" }
  | { state: "cancelled" }
  | { state: "refunded" }
  | { state: "paid"; amount: string; currency: "USD" };

export interface PaymentProvider {
  readonly id: string;
  createCheckout(order: PaymentOrder): Promise<CheckoutDetails>;
  verifyPayment(order: PaymentOrder): Promise<VerifiedPayment>;
}

type PayWayConfig = {
  merchantId: string;
  apiKey: string;
  baseUrl: string;
  callbackUrl: string;
};

type PayWayQrResponse = {
  status?: { code?: unknown; message?: unknown };
  qrImage?: unknown;
  qrString?: unknown;
  amount?: unknown;
  currency?: unknown;
};

type PayWayStatusResponse = {
  status?: { code?: unknown };
  data?: {
    payment_status_code?: unknown;
    payment_status?: unknown;
    total_amount?: unknown;
    payment_currency?: unknown;
  };
};

class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

function getPayWayConfig(): PayWayConfig | null {
  const merchantId = process.env.PAYWAY_MERCHANT_ID;
  const apiKey = process.env.PAYWAY_API_KEY;
  const callbackSecret = process.env.PAYWAY_CALLBACK_SECRET;
  const publicUrl = process.env.BUILDER_PUBLIC_URL;
  if (!merchantId || !apiKey || !callbackSecret || callbackSecret.length < 32 || !publicUrl) return null;
  const environment = process.env.PAYWAY_ENVIRONMENT ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new PaymentProviderError("PayWay environment configuration is invalid.");
  }
  const callback = new URL("/api/payments/webhook/aba", publicUrl);
  if (callback.protocol !== "https:") {
    throw new PaymentProviderError("The PayWay callback URL must use HTTPS.");
  }
  callback.searchParams.set("token", callbackSecret);
  return {
    merchantId,
    apiKey,
    callbackUrl: Buffer.from(callback.toString()).toString("base64"),
    baseUrl:
      environment === "production"
        ? "https://checkout.payway.com.kh"
        : "https://checkout-sandbox.payway.com.kh",
  };
}

function requestTime() {
  const date = new Date();
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("");
}

function makeHash(parts: string[], apiKey: string) {
  return createHmac("sha512", apiKey).update(parts.join("")).digest("base64");
}

async function readProviderJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok || !text) throw new PaymentProviderError("PayWay request failed.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new PaymentProviderError("PayWay returned an invalid response.");
  }
}

function assertPayWayStatusCode(code: unknown) {
  if (String(code) !== "0" && String(code) !== "00") {
    throw new PaymentProviderError("PayWay did not accept the payment request.");
  }
}

function getConfigOrThrow() {
  const config = getPayWayConfig();
  if (!config) throw new PaymentProviderError("ABA PayWay is not configured.");
  return config;
}

export const abaPayWayProvider: PaymentProvider = {
  id: "aba_payway",
  async createCheckout(order) {
    const config = getConfigOrThrow();
    const reqTime = requestTime();
    const amount = order.amount;
    const purchaseType = "purchase";
    const paymentOption = "abapay_khqr";
    const currency = "USD";
    const lifetime = "15";
    const qrImageTemplate = "template3_color";
    const itemData = Buffer.from(
      JSON.stringify([{ name: order.planId === "pro_monthly" ? "Phollet AI Pro Monthly" : "Phollet AI Pro Annual", quantity: 1, price: Number(amount) }]),
    ).toString("base64");
    const returnParams = Buffer.from(JSON.stringify({ order_id: order.id })).toString("base64");
    const fields = {
      req_time: reqTime,
      merchant_id: config.merchantId,
      tran_id: order.tranId,
      amount,
      items: itemData,
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      purchase_type: purchaseType,
      payment_option: paymentOption,
      callback_url: config.callbackUrl,
      return_deeplink: "",
      currency,
      custom_fields: "",
      return_params: returnParams,
      payout: "",
      lifetime,
      qr_image_template: qrImageTemplate,
    };
    const hash = makeHash(Object.values(fields), config.apiKey);
    const response = await fetch(`${config.baseUrl}/api/payment-gateway/v1/payments/generate-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, hash }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const result = await readProviderJson<PayWayQrResponse>(response);
    assertPayWayStatusCode(result.status?.code);
    if (
      typeof result.qrImage !== "string" ||
      !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(result.qrImage) ||
      result.qrImage.length > 1_000_000 ||
      typeof result.qrString !== "string" ||
      !result.qrString ||
      String(result.amount) !== amount ||
      result.currency !== currency
    ) {
      throw new PaymentProviderError("PayWay returned invalid QR payment details.");
    }

    return {
      provider: "aba_payway",
      qrImage: result.qrImage,
      qrString: result.qrString,
      expiresAt: new Date(Date.now() + Number(lifetime) * 60_000).toISOString(),
    };
  },
  async verifyPayment(order) {
    const config = getConfigOrThrow();
    const reqTime = requestTime();
    const hash = makeHash([reqTime, config.merchantId, order.tranId], config.apiKey);
    const response = await fetch(
      `${config.baseUrl}/api/payment-gateway/v1/payments/check-transaction-2`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          req_time: reqTime,
          merchant_id: config.merchantId,
          tran_id: order.tranId,
          hash,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const result = await readProviderJson<PayWayStatusResponse>(response);
    if (String(result.status?.code) !== "00") {
      throw new PaymentProviderError("PayWay could not verify this transaction.");
    }
    const data = result.data;
    if (!data) throw new PaymentProviderError("PayWay returned no transaction status.");

    const statusCode = Number(data.payment_status_code);
    const status = String(data.payment_status ?? "").toUpperCase();
    if (statusCode === 0 && status === "APPROVED") {
      if (
        (data.payment_currency !== "USD" && data.payment_currency !== "KHR") ||
        Number(data.total_amount).toFixed(2) !== Number(order.amount).toFixed(2)
      ) {
        throw new PaymentProviderError("Verified payment amount does not match this order.");
      }
      return { state: "paid", amount: Number(data.total_amount).toFixed(2), currency: "USD" };
    }
    if (statusCode === 2 || status === "PENDING") return { state: "pending" };
    if (statusCode === 3 || status === "DECLINED") return { state: "declined" };
    if (statusCode === 7 || status === "CANCELLED") return { state: "cancelled" };
    if (statusCode === 4 || status === "REFUNDED") return { state: "refunded" };
    throw new PaymentProviderError("PayWay returned an unsupported transaction status.");
  },
};

export function getPaymentProvider(providerId = process.env.PAYMENT_PROVIDER ?? "aba_payway"): PaymentProvider {
  if (providerId === "aba_payway") return abaPayWayProvider;
  throw new PaymentProviderError("The requested payment provider is not configured.");
}
