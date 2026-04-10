/**
 * Email provider — DEMO implementation.
 * Logs to console and writes to data/demo-emails/ for verification.
 *
 * To integrate real email (SendGrid, Mailgun, AWS SES, nodemailer):
 * 1. pnpm add @sendgrid/mail (or nodemailer, etc.)
 * 2. Replace the send() function below with the real API call
 * 3. Keep the same InviteMessageParams interface
 */

import type { InviteMessageParams, SendResult } from "./types";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

function buildEmailHtml(params: InviteMessageParams): string {
  const curriculum = [params.boardName, params.grade ? `Class ${params.grade}` : null, params.subjectName].filter(Boolean).join(" · ");

  return `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #7C3AED, #4F46E5); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">📚 Padvik</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0;">You're invited to join a classroom</p>
  </div>
  <div style="border: 1px solid #e5e7eb; border-top: none; padding: 30px; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px;">Hi ${params.recipientName},</p>
    <p><strong>${params.creatorName}</strong> has invited you to join their classroom:</p>
    <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <h3 style="margin: 0 0 8px; color: #7C3AED;">${params.classroomName}</h3>
      ${curriculum ? `<p style="margin: 0; color: #6b7280; font-size: 14px;">${curriculum}</p>` : ""}
    </div>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${params.inviteLink}" style="background: #7C3AED; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Join Classroom</a>
    </div>
    <p style="color: #6b7280; font-size: 13px; text-align: center;">
      Or enter this code on Padvik: <strong style="color: #7C3AED; font-size: 16px; letter-spacing: 2px;">${params.joinCode}</strong>
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
      Padvik — AI-powered curriculum learning platform for Indian K-12 students
    </p>
  </div>
</body>
</html>`.trim();
}

export async function sendEmail(params: InviteMessageParams): Promise<SendResult> {
  const subject = `You're invited to join "${params.classroomName}" on Padvik`;
  const html = buildEmailHtml(params);
  const messageId = `demo-email-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // ── DEMO: Write to file for verification ──
  // Replace this block with real email API call:
  // e.g. await sgMail.send({ to: params.recipientEmail, from: 'noreply@padvik.com', subject, html });
  try {
    const demoDir = join(process.cwd(), "data", "demo-emails");
    if (!existsSync(demoDir)) mkdirSync(demoDir, { recursive: true });

    writeFileSync(
      join(demoDir, `${messageId}.json`),
      JSON.stringify({
        to: params.recipientEmail,
        subject,
        html,
        params,
        sentAt: new Date().toISOString(),
      }, null, 2)
    );

    // Also write the HTML for easy preview
    writeFileSync(join(demoDir, `${messageId}.html`), html);

    console.log(`[EMAIL-DEMO] Invite sent to ${params.recipientEmail} — ${demoDir}/${messageId}.html`);

    return { success: true, channel: "email", messageId };
  } catch (err) {
    console.error("[EMAIL-DEMO] Failed:", err);
    return { success: false, channel: "email", error: err instanceof Error ? err.message : "Failed" };
  }
}
