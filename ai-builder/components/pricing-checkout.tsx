"use client";

import { useEffect, useState } from "react";
import { Check, Clipboard, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import type { PlanId } from "@/lib/payments/plans";

type Checkout = {
  orderId: string;
  planId: PlanId;
  amount: string;
  currency: string;
  qrImage: string;
  qrString: string;
  expiresAt: string;
};

type PaymentStatus = "pending" | "paid" | "declined" | "cancelled" | "refunded" | "expired";

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error("The payment service returned an invalid response.");
  }
}

function responseError(value: unknown) {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string"
    ? value.error
    : "The payment request could not be completed.";
}

export default function PricingCheckout() {
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busyPlan, setBusyPlan] = useState<PlanId | null>(null);
  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!checkout || status !== "pending") return;
    const orderId = checkout.orderId;
    let active = true;
    let inFlight = false;
    async function verify() {
      if (!active || inFlight) return;
      inFlight = true;
      setVerifying(true);
      try {
        const response = await fetch("/api/payments/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
          cache: "no-store",
        });
        const body = parseJson(await response.text());
        if (!response.ok) throw new Error(responseError(body));
        if (
          typeof body !== "object" ||
          body === null ||
          !("status" in body) ||
          !["pending", "paid", "declined", "cancelled", "refunded", "expired"].includes(String(body.status))
        ) {
          throw new Error("The payment service returned an unknown payment status.");
        }
        if (active) setStatus(body.status as PaymentStatus);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not verify payment status.");
      } finally {
        inFlight = false;
        if (active) setVerifying(false);
      }
    }

    void verify();
    const interval = window.setInterval(() => void verify(), 10_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [checkout, status]);

  async function startCheckout(planId: PlanId) {
    const key = crypto.randomUUID();
    setBusyPlan(planId);
    setCheckout(null);
    setStatus("pending");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, checkoutKey: key }),
        cache: "no-store",
      });
      const body = parseJson(await response.text());
      if (!response.ok) throw new Error(responseError(body));
      if (
        typeof body !== "object" ||
        body === null ||
        !("orderId" in body) ||
        typeof body.orderId !== "string" ||
        !("qrImage" in body) ||
        typeof body.qrImage !== "string" ||
        !("qrString" in body) ||
        typeof body.qrString !== "string" ||
        !("expiresAt" in body) ||
        typeof body.expiresAt !== "string"
      ) {
        throw new Error("The payment service returned incomplete QR details.");
      }
      setCheckout(body as Checkout);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout.");
    } finally {
      setBusyPlan(null);
    }
  }

  function closeCheckout() {
    setCheckout(null);
    setError("");
    setNotice("");
    setCopied(false);
  }

  async function copyQrString() {
    if (!checkout) return;
    try {
      await navigator.clipboard.writeText(checkout.qrString);
      setCopied(true);
      setNotice("KHQR payment string copied.");
    } catch {
      setError("Could not copy the QR payment string in this browser.");
    }
  }

  return (
    <>
      <section className="mx-auto mt-4 grid max-w-3xl gap-3 rounded-2xl border border-white/10 bg-[#101419] p-5 sm:grid-cols-2 sm:p-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Cambodia checkout</h2>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Pay once for the selected term using ABA PayWay KHQR. Plans do not auto-renew; you must renew manually.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-2 sm:items-end">
          <button
            type="button"
            onClick={() => void startCheckout("pro_monthly")}
            disabled={busyPlan !== null}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            {busyPlan === "pro_monthly" && <LoaderCircle size={15} className="animate-spin" />}
            Pay $14.99 monthly
          </button>
          <button
            type="button"
            onClick={() => void startCheckout("pro_annual")}
            disabled={busyPlan !== null}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            {busyPlan === "pro_annual" && <LoaderCircle size={15} className="animate-spin" />}
            Pay $129.99 annually
          </button>
        </div>
        <div className="sm:col-span-2">
          <p className="text-xs leading-5 text-slate-500">
            New customers must <Link href="/" className="text-emerald-300 hover:text-emerald-200">create and verify an account</Link> before checkout. Amounts are USD; your bank may apply its own conversion or fees.
          </p>
          {error && !checkout && <p role="alert" className="mt-3 text-xs leading-5 text-rose-300">{error}</p>}
        </div>
      </section>

      {checkout && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && status !== "pending") closeCheckout();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="khqr-title"
            className="my-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#11171d] p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="khqr-title" className="text-base font-semibold text-slate-100">Pay with ABA KHQR</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {checkout.planId === "pro_monthly" ? "Phollet AI Pro · monthly" : "Phollet AI Pro · annual"} · ${checkout.amount} USD
                </p>
              </div>
              <button type="button" onClick={closeCheckout} aria-label="Close checkout" className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06]">
                <X size={17} />
              </button>
            </div>
            {status === "pending" ? (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-300">Scan this dynamic KHQR using ABA Mobile or another supported KHQR banking app. Keep this page open while the payment is verified.</p>
                <div className="mx-auto mt-4 grid size-64 max-w-full place-items-center rounded-xl bg-white p-3">
                  <img src={checkout.qrImage} alt="Dynamic ABA KHQR payment code" className="max-h-full max-w-full object-contain" />
                </div>
                <button type="button" onClick={() => void copyQrString()} className="mx-auto mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]">
                  <Clipboard size={14} />
                  {copied ? "Copied QR string" : "Copy QR payment string"}
                </button>
                <p className="mt-2 text-center text-xs text-slate-500">
                  Expires {new Date(checkout.expiresAt).toLocaleTimeString()} · {verifying ? "Checking PayWay status…" : "Waiting for payment"}
                </p>
                {error && <p role="alert" className="mt-3 text-center text-xs leading-5 text-rose-300">{error}</p>}
              </>
            ) : (
              <div className="mt-6 space-y-3 text-center">
                <p role="status" className={`text-sm font-semibold ${status === "paid" ? "text-emerald-300" : "text-amber-200"}`}>
                  {status === "paid" ? "Payment verified. Phollet AI Pro is active." : `Payment status: ${status}.`}
                </p>
                {status === "paid" ? (
                  <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-400">
                    Continue to Builder
                  </Link>
                ) : (
                  <p className="text-xs leading-5 text-slate-400">No Pro access was granted for this payment. You can start a new checkout if needed.</p>
                )}
                <button type="button" onClick={closeCheckout} className="block w-full rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06]">
                  Close
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
