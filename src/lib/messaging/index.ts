/**
 * Unified messaging service — routes invites to the correct channel.
 * All channels are demo stubs. To integrate real APIs:
 * - Email: edit src/lib/messaging/email.ts
 * - SMS: edit src/lib/messaging/sms.ts
 * - WhatsApp: edit src/lib/messaging/whatsapp.ts
 */

import type { InviteMessageParams, SendResult, MessageChannel } from "./types";
import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { sendWhatsapp } from "./whatsapp";

export type { InviteMessageParams, SendResult, MessageChannel };

/**
 * Send an invite via the specified channel.
 */
export async function sendInvite(
  channel: MessageChannel,
  params: InviteMessageParams
): Promise<SendResult> {
  switch (channel) {
    case "email":
      if (!params.recipientEmail) {
        return { success: false, channel, error: "Email address is required" };
      }
      return sendEmail(params);

    case "sms":
      if (!params.recipientPhone) {
        return { success: false, channel, error: "Phone number is required" };
      }
      return sendSms(params);

    case "whatsapp":
      if (!params.recipientPhone) {
        return { success: false, channel, error: "Phone number is required for WhatsApp" };
      }
      return sendWhatsapp(params);

    default:
      return { success: false, channel, error: `Unknown channel: ${channel}` };
  }
}

/**
 * Generate the invite link URL for a given token.
 */
export function getInviteLink(token: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${baseUrl}/join/${token}`;
}
