/**
 * A WhatsApp share link with the message pre-filled. The member picks who to
 * send it to in WhatsApp; nothing is sent until they press send there.
 */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
