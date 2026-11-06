import { pushChannel, sendPush } from '@/lib/push'
import { getSettings, updateSettings } from '@/lib/settings/service'
import { defineCommand } from '../registry'

export const notify = defineCommand({
  name: 'notify',
  description: 'Phone notifications: on, off or send a test',
  usage: '/notify on|off|test',
  group: 'Settings',
  risk: 'action',
  args: [{ name: 'mode', required: true, choices: ['on', 'off', 'test'] }],
  async handler({ args }) {
    const mode = args[0].toLowerCase()
    if (mode === 'test') {
      const r = await sendPush({ title: 'Job Pilot test', body: 'Phone notifications work.', link: '/mail', priority: 'default' })
      return r.ok ? `Test sent through ${r.channel}.` : `Test failed: ${r.error ?? 'unknown error'}`
    }
    await updateSettings({ general: { pushEnabled: mode === 'on' } })
    const s = await getSettings()
    return `Phone notifications are ${s.pushEnabled ? 'ON' : 'OFF'} (channel: ${(await pushChannel()) ?? 'none'}). Commands keep working either way.`
  },
})
