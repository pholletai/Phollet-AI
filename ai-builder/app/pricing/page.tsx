import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, CreditCard, Sparkles } from "lucide-react";
import PricingCheckout from "@/components/pricing-checkout";

export const metadata: Metadata = {
  title: "Phollet AI Pro Pricing",
  description: "Planned Phollet AI Pro plan pricing and billing disclosures.",
};

const features = [
  "AI-assisted React and TypeScript project generation",
  "Editable source code with a live browser preview",
  "Image prompts, subject to configured provider support",
  "Voice input where supported by the browser",
];

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-[#0b0e12] px-4 py-8 text-slate-100 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to Builder
        </Link>

        <header className="mx-auto mt-10 max-w-2xl text-center sm:mt-14">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-emerald-300/15 bg-emerald-400/10 text-emerald-300">
            <Sparkles size={21} />
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Simple, planned pricing
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Phollet AI Pro
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400 sm:text-base">
            Pricing for Phollet AI Builder. ABA KHQR checkout is available when the account and merchant configuration are active.
          </p>
        </header>

        <section aria-label="Pro plan prices" className="mx-auto mt-9 grid max-w-3xl gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-white/10 bg-[#101419] p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-200">Monthly</h2>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">$14.99</span>
              <span className="text-sm text-slate-500">/ month</span>
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">Planned monthly price, billed in USD.</p>
          </article>
          <article className="rounded-2xl border border-emerald-300/30 bg-emerald-300/[0.06] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-200">Annual</h2>
              <span className="rounded-full border border-emerald-300/20 px-2.5 py-1 text-[10px] font-medium text-emerald-200">
                Planned annual plan
              </span>
            </div>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">$129.99</span>
              <span className="text-sm text-slate-500">/ year</span>
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">Planned annual price, billed in USD.</p>
          </article>
        </section>

        <PricingCheckout />

        <section className="mx-auto mt-4 max-w-3xl rounded-2xl border border-white/10 bg-[#101419] p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-100">Planned Pro features</h2>
          <ul className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 leading-5">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                {feature}
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="billing-disclosures"
          className="mx-auto mt-4 max-w-3xl rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-5 sm:p-6"
        >
          <h2 id="billing-disclosures" className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <CreditCard size={16} />
            Business and billing details
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Service provider</dt>
              <dd className="mt-1 text-slate-200">Phollet AI Technologies Co., Ltd.</dd>
            </div>
            <div>
              <dt className="text-slate-500">Currency and terms</dt>
              <dd className="mt-1 text-slate-200">USD · monthly or annual plan</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Payment availability</dt>
              <dd className="mt-1 text-slate-200">
                ABA PayWay KHQR is used for Cambodia checkout when credentials are configured. Each purchase covers one term and does not auto-renew.
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-amber-300/10 pt-4 text-xs leading-5 text-slate-400">
            Before accepting payments, the company’s registered jurisdiction and address, registration details,
            customer support contact, applicable taxes, renewal and cancellation terms, and refund/privacy policies
            must be confirmed and published. No registration, tax, or compliance certification is represented here.
          </p>
        </section>

        <footer className="mx-auto mt-6 max-w-3xl text-center text-[11px] leading-5 text-slate-600">
          Plan inclusions and provider availability may change before the paid service launches.
        </footer>
      </div>
    </main>
  );
}
