/**
 * Messaging types — shared across email, SMS, and WhatsApp providers.
 */

export type MessageChannel = "email" | "sms" | "whatsapp";

export interface InviteMessageParams {
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;
  creatorName: string;
  classroomName: string;
  boardName?: string;
  grade?: number;
  subjectName?: string;
  joinCode: string;
  inviteToken: string;
  inviteLink: string;
}

export interface SendResult {
  success: boolean;
  channel: MessageChannel;
  messageId?: string;
  error?: string;
}

export interface MessageProvider {
  send(params: InviteMessageParams): Promise<SendResult>;
}
