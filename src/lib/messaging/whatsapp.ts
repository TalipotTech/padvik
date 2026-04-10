/**
 * WhatsApp provider — DEMO implementation.
 * Logs to console and writes to data/demo-whatsapp/ for verification.
 *
 * To integrate real WhatsApp (Twilio WhatsApp API, Meta Cloud API):
 * 1. pnpm add twilio (WhatsApp via Twilio) or use Meta's Graph API
 * 2. Replace the send() function below with the real API call
 * 3. Keep the same InviteMessageParams interface
 *
 * WhatsApp Business API requires approved message templates.
 * Template example: "classroom_invite" with variables:
 *   {{1}} = student name, {{2}} = creator name, {{3}} = classroom name,
 *   {{4}} = invite link, {{5}} = join code
 */

import type { InviteMessageParams, SendResult } from "./types";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

function buildWhatsappText(params: InviteMessageParams): string {
  const curriculum = [params.boardName, params.grade ? `Class ${params.grade}` : null, params.subjectName].filter(Boolean).join(" · ");

  return [
    `📚 *Padvik Classroom Invite*`,
    ``,
    `Hi ${params.recipientName}! 👋`,
    ``,
    `*${params.creatorName}* has invited you to join:`,
    `📖 *${params.classroomName}*`,
    curriculum ? `${curriculum}` : null,
    ``,
    `👉 Join here: ${params.inviteLink}`,
    ``,
    `Or enter code on Padvik: *${params.joinCode}*`,
    ``,
    `— _Padvik · Learn Smarter_`,
  ].filter(s => s !== null).join("\n");
}

export async function sendWhatsapp(params: InviteMessageParams): Promise<SendResult> {
  const text = buildWhatsappText(params);
  const messageId = `demo-wa-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // ── DEMO: Write to file for verification ──
  // Replace with Twilio WhatsApp:
  // await twilioClient.messages.create({ to: `whatsapp:${params.recipientPhone}`, from: 'whatsapp:+14155238886', body: text });
  try {
    const demoDir = join(process.cwd(), "data", "demo-whatsapp");
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

    console.log(`[WHATSAPP-DEMO] Invite sent to ${params.recipientPhone}\n${text}`);

    return { success: true, channel: "whatsapp", messageId };
  } catch (err) {
    console.error("[WHATSAPP-DEMO] Failed:", err);
    return { success: false, channel: "whatsapp", error: err instanceof Error ? err.message : "Failed" };
  }
}
