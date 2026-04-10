/**
 * SMS provider — DEMO implementation.
 * Logs to console and writes to data/demo-sms/ for verification.
 *
 * To integrate real SMS (Twilio, MSG91, AWS SNS):
 * 1. pnpm add twilio (or msg91, etc.)
 * 2. Replace the send() function below with the real API call
 * 3. Keep the same InviteMessageParams interface
 */

import type { InviteMessageParams, SendResult } from "./types";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

function buildSmsText(params: InviteMessageParams): string {
  return `Hi ${params.recipientName}! ${params.creatorName} invited you to join "${params.classroomName}" on Padvik. Join: ${params.inviteLink} or use code: ${params.joinCode}`;
}

export async function sendSms(params: InviteMessageParams): Promise<SendResult> {
  const text = buildSmsText(params);
  const messageId = `demo-sms-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // ── DEMO: Write to file for verification ──
  // Replace with: await twilioClient.messages.create({ to: params.recipientPhone, from: TWILIO_FROM, body: text });
  try {
    const demoDir = join(process.cwd(), "data", "demo-sms");
    if (!existsSync(demoDir)) mkdirSync(demoDir, { recursive: true });

    writeFileSync(
      join(demoDir, `${messageId}.json`),
      JSON.stringify({
        to: params.recipientPhone,
        body: text,
        params,
        sentAt: new Date().toISOString(),
      }, null, 2)
    );

    console.log(`[SMS-DEMO] Invite sent to ${params.recipientPhone} — ${text}`);

    return { success: true, channel: "sms", messageId };
  } catch (err) {
    console.error("[SMS-DEMO] Failed:", err);
    return { success: false, channel: "sms", error: err instanceof Error ? err.message : "Failed" };
  }
}
