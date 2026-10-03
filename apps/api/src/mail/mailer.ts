import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/** Plain text always; `html` optionally, for mail clients that show it. */
export type Mail = { to: string; subject: string; text: string; html?: string };

/** Mail "sent" with MAIL_TRANSPORT=memory (tests), newest last. */
export const mailOutbox: Mail[] = [];

/**
 * Email from the hosted server (owner password resets). Set one of:
 * - SMTP_URL, e.g. smtps://user:password@smtp.example.com:465, with MAIL_FROM;
 * - MAIL_TRANSPORT=log: printed to the API's log instead (development only);
 * - MAIL_TRANSPORT=memory: kept in `mailOutbox` (tests).
 * With none, nothing can be sent and the features that need email say so.
 */
/**
 * Short timeouts unless SMTP_URL sets its own (?connectionTimeout=…): a slow mail server must
 * not hold up the request that sends a notice.
 */
function withTimeouts(smtpUrl: string) {
  const url = new URL(smtpUrl);
  for (const [name, ms] of [['connectionTimeout', '10000'], ['greetingTimeout', '10000'], ['socketTimeout', '20000']]) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, ms);
  }
  return url.toString();
}

@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mail');
  private transport: Transporter | null = null;

  private mode() {
    const transport = process.env.MAIL_TRANSPORT?.trim().toLowerCase();
    if (transport === 'memory' || transport === 'log') return transport;
    return process.env.SMTP_URL?.trim() ? 'smtp' : null;
  }

  /**
   * For notices that must not hold anything up (a business is ready, a password changed): sent
   * when email is set up, and a failure is only logged.
   */
  async sendNotice(mail: Mail) {
    if (this.mode() === null) return;
    // send() has logged why.
    await this.send(mail).catch(() => undefined);
  }

  /** Fails (503) when this server can't send email. */
  assertConfigured() {
    if (this.mode() === null) {
      throw new ServiceUnavailableException("Email isn't set up on this server, so this can't be done. Contact the server's support.");
    }
  }

  async send(mail: Mail) {
    switch (this.mode()) {
      case 'memory':
        mailOutbox.push(mail);
        return;
      case 'log':
        this.logger.log(`To ${mail.to}: ${mail.subject}\n${mail.text}`);
        return;
      case 'smtp': {
        this.transport ??= createTransport(withTimeouts(process.env.SMTP_URL!.trim()));
        try {
          await this.transport.sendMail({
            from: process.env.MAIL_FROM?.trim() || 'Point of Sale <no-reply@localhost>',
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            ...(mail.html ? { html: mail.html } : {})
          });
        } catch (error) {
          // The reason (a wrong SMTP login, a blocked port) is for the server's log, not the app.
          this.logger.error(`Couldn't email "${mail.subject}" to ${mail.to}: ${error instanceof Error ? error.message : String(error)}`);
          throw new ServiceUnavailableException("Couldn't send the email just now. Try again in a few minutes; if it keeps failing, contact the server's support.");
        }
        return;
      }
      default:
        this.assertConfigured();
    }
  }
}
