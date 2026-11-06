import { createRegistry, type CommandDef, type CommandRegistry } from '../registry'
import { ai, ask } from './ai'
import { apply } from './apply'
import { applymore } from './applymore'
import { help } from './help'
import { job } from './job'
import { loops } from './loops'
import { mail } from './mail'
import { metrics } from './metrics'
import { notify } from './notify'
import { pause } from './pause'
import { replies } from './replies'
import { resume } from './resume'
import { search } from './search'
import { sendnow } from './sendnow'
import { sendready } from './sendready'
import { stats } from './stats'
import { status } from './status'
import { todo } from './todo'
import { whoami } from './whoami'

/** Every command the bot has. A new file under commands/ is added here and nowhere else. */
export const COMMANDS: readonly CommandDef[] = [help, status, todo, replies, mail, stats, loops, job, search, apply, applymore, pause, resume, sendnow, sendready, ai, ask, metrics, notify, whoami]

export function buildRegistry(): CommandRegistry {
  return createRegistry(COMMANDS)
}
