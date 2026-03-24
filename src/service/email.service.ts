/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private resend = new Resend(process.env.RESEND_API_KEY);

  async sendContactEmail(data: any) {
    const { name, email, phone, message } = data;

    const toEmail = process.env.EMAIL_USER as string;

    if (!toEmail) {
      throw new Error('EMAIL_USER is not defined');
    }

    // 1. Send to YOU (lead notification)
    await this.resend.emails.send({
      from: 'onboarding@resend.dev',
      to: toEmail,
      subject: '🔥 New Lead from Website',
      html: `
        <h2>New Lead</h2>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Phone:</b> ${phone}</p>
        <p><b>Message:</b> ${message || '—'}</p>
      `,
    });

    // 2. Auto-reply to user
    await this.resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: 'We received your request',
      html: `
        <p>Hi ${name},</p>
        <p>Thanks for reaching out. We’ll contact you shortly.</p>
      `,
    });
  }
}
