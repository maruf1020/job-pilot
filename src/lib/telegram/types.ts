/** The slice of the Telegram Bot API this bot uses. */

export interface TgUser {
  id: number
  is_bot?: boolean
}
export interface TgChat {
  id: number
  type?: string
}
export interface TgMessage {
  message_id: number
  /** Unix seconds. */
  date: number
  chat: TgChat
  from?: TgUser
  text?: string
}
export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}
export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

export interface InlineButton {
  text: string
  callback_data: string
}
export type InlineKeyboard = InlineButton[][]

export interface BotCommandMenuItem {
  command: string
  description: string
}
