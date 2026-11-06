import { FOLDER_META, MAIL_FOLDERS } from '@/lib/mail/folders'
import { loadMail } from '@/lib/mail/loader'
import { appLink } from '../format'
import { defineCommand } from '../registry'

export const mail = defineCommand({
  name: 'mail',
  description: 'Mail folder counts',
  usage: '/mail',
  group: 'Mail',
  risk: 'read',
  async handler({ now }) {
    const { counts } = await loadMail('needs-answer', 1, now)
    return ['**Mail folders**', ...MAIL_FOLDERS.map((f) => `${counts[f]} ${FOLDER_META[f].label}`), '', appLink('/mail')].join('\n')
  },
})
