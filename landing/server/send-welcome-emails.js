import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');

async function loadSubscribers() {
  const raw = await fs.readFile(SUBSCRIBERS_FILE, 'utf-8');
  const data = JSON.parse(raw);
  return data.subscribers ?? [];
}

async function main() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    FROM_EMAIL,
    TO_OVERRIDE,
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
    console.error(
      'Missing SMTP configuration. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL (and optionally TO_OVERRIDE).'
    );
    process.exit(1);
  }

  const subscribers = await loadSubscribers();

  if (!subscribers.length) {
    console.log('No subscribers found.');
    return;
  }

  const emails = Array.from(
    new Set(subscribers.map((s) => s.email.toLowerCase().trim()).filter(Boolean))
  );

  console.log(`Preparing to email ${emails.length} subscriber(s)...`);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const toList = TO_OVERRIDE || emails.join(', ');

  const info = await transporter.sendMail({
    from: FROM_EMAIL,
    to: TO_OVERRIDE || undefined,
    bcc: TO_OVERRIDE ? undefined : emails,
    subject: 'Thanks for subscribing to Wealth Wards',
    text: [
      'Hi,',
      '',
      'Thanks for joining the Wealth Wards early access list.',
      'We are working on something special to help you protect and grow your wealth.',
      'You will be hearing more from us soon.',
      '',
      'In the meantime, you can reply to this email if you have any questions or ideas.',
      '',
      '— The Wealth Wards Team',
    ].join('\n'),
    html: `
      <p>Hi,</p>
      <p>Thanks for joining the <strong>Wealth Wards</strong> early access list.</p>
      <p>We are working on something special to help you protect and grow your wealth.<br/>
      You will be hearing more from us soon.</p>
      <p>In the meantime, you can reply to this email if you have any questions or ideas.</p>
      <p>— <strong>The Wealth Wards Team</strong></p>
    `,
  });

  console.log('Email sent. Message ID:', info.messageId);
  console.log('Recipients:', toList);
}

main().catch((err) => {
  console.error('Failed to send welcome emails:', err);
  process.exit(1);
});

