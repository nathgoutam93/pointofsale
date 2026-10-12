import { createTransport, type Transporter } from 'nodemailer';
import { mailMode } from '../config';

export type Mail = { to: string[]; subject: string; text: string };

/** Mail "sent" with MAIL_TRANSPORT=memory (tests), newest last. */
export const mailOutbox: Mail[] = [];

let transport: Transporter | null = null;

/** Short timeouts unless SMTP_URL sets its own (?connectionTimeout=…), so a slow mail server can't hold up the timer. */
function withTimeouts(smtpUrl: string) {
  const url = new URL(smtpUrl);
  for (const [name, ms] of [['connectionTimeout', '10000'], ['greetingTimeout', '10000'], ['socketTimeout', '20000']]) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, ms);
  }
  return url.toString();
}

/** Sends one email as mailMode() says; throws when it can't. */
export async function sendMail(mail: Mail) {
  switch (mailMode()) {
    case 'memory':
      mailOutbox.push(mail);
      return;
    case 'log':
      process.stdout.write(`${JSON.stringify({ event: 'mail', to: mail.to, subject: mail.subject, text: mail.text })}\n`);
      return;
    case 'smtp':
      transport ??= createTransport(withTimeouts(process.env.SMTP_URL!.trim()));
      await transport.sendMail({
        from: process.env.MAIL_FROM?.trim() || 'Checkout <no-reply@localhost>',
        to: mail.to,
        subject: mail.subject,
        text: mail.text
      });
      return;
    default:
      throw new Error('No way to send email: set SMTP_URL');
  }
}
