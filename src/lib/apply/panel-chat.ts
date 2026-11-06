/**
 * The chat in the panel on a form (a real conversation: the person writes, sees the AI thinking, then
 * gets its reply). The thread lives in the page (window.__jfChat, kept in
 * sessionStorage across pages of the same site); bannerInPage draws it and defines __jfRenderChat.
 */

export type ChatMessage = { role: 'you' | 'ai'; text: string }

/** Add a message and/or set the "thinking" line (null clears it). Runs inside the page. */
export function chatInPage(arg: { add?: ChatMessage; thinking?: string | null }) {
  const w = window as unknown as { __jfChat?: ChatMessage[]; __jfThinking?: string | null; __jfRenderChat?: () => void }
  if (!w.__jfChat) {
    try {
      w.__jfChat = JSON.parse(sessionStorage.getItem('jf-chat') ?? '[]') as ChatMessage[]
    } catch {
      w.__jfChat = []
    }
  }
  if (arg.add) {
    w.__jfChat.push(arg.add)
    try {
      sessionStorage.setItem('jf-chat', JSON.stringify(w.__jfChat.slice(-30)))
    } catch {
      // A private window: the thread lasts until the page changes.
    }
  }
  if (arg.thinking !== undefined) w.__jfThinking = arg.thinking
  w.__jfRenderChat?.()
}
