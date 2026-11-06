import { defineCommand } from '../registry'

export const whoami = defineCommand({
  name: 'whoami',
  description: 'Show this chat id and that it is the authorised chat',
  usage: '/whoami',
  group: 'Settings',
  risk: 'read',
  // Only the authorised chat ever reaches a handler, so the answer is always "yes".
  handler: async ({ chatId }) => `Chat id ${chatId}. This is the authorised chat (TELEGRAM_CHAT_ID); other chats get no answer at all.`,
})
