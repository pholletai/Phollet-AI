import nodemailer from "nodemailer";

export class MailConfigurationError extends Error {
  constructor() {
    super("Email verification is not configured.");
    this.name = "MailConfigurationError";
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM, BUILDER_PUBLIC_URL } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD || !EMAIL_FROM || !BUILDER_PUBLIC_URL) {
    throw new MailConfigurationError();
  }
  const baseUrl = new URL(BUILDER_PUBLIC_URL);
  if (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
    throw new MailConfigurationError();
  }

  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new MailConfigurationError();
  const verificationUrl = new URL("/", baseUrl);
  verificationUrl.searchParams.set("verify", token);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: email,
    subject: "Verify your Phollet AI account",
    text: `Verify your email address by opening this link. It expires in 30 minutes.\n\n${verificationUrl.toString()}\n\nIf you did not create a Phollet AI account, you can ignore this message.`,
  });
}
