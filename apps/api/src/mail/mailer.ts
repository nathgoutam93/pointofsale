import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export type Mail = { to: string; subject: string; text: string };

/** Mail "sent" with MAIL_TRANSPORT=memory (tests), newest last. */
export const mailOutbox: Mail[] = [];

/**
 * Email from the hosted server (owner password resets). Set one of:
 * - SMTP_URL, e.g. smtps://user:password@smtp.example.com:465, with MAIL_FROM;
 * - MAIL_TRANSPORT=log: printed to the API's log instead (development only);
 * - MAIL_TRANSPORT=memory: kept in `mailOutbox` (tests).
 * With none, nothing can be sent and the features that need email say so.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mail');
  private transport: Transporter | null = null;

  private mode() {
    const transport = process.env.MAIL_TRANSPORT?.trim().toLowerCase();
    if (transport === 'memory' || transport === 'log') return transport;
    return process.env.SMTP_URL?.trim() ? 'smtp' : null;
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
        this.transport ??= createTransport(process.env.SMTP_URL!.trim());
        await this.transport.sendMail({
          from: process.env.MAIL_FROM?.trim() || 'Point of Sale <no-reply@localhost>',
          to: mail.to,
          subject: mail.subject,
          text: mail.text
        });
        return;
      }
      default:
        this.assertConfigured();
    }
  }
}
