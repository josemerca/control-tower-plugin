import { ShellWord } from './shell-word.js'

export class CmuxLauncher {
  static SCRIPT_NAME = 'launch.sh'
  static SENTINEL_NAME = 'started'
  static MAGIC = 'ct-plan-launch'
  static VERSION = '1'
  static RESOLVED = 'ok'
  static MISSING = 'missing'

  static typedFor(script) {
    return `. ${ShellWord.quote(script)}`
  }

  static scriptFor({ sentinel, errand, bin }) {
    const quoted = ShellWord.quote(sentinel)

    return [
      '#!/bin/sh',
      `if [ -e ${quoted} ]; then`,
      `  printf '%s\\n' 'ct-plan: la sesión ya arrancó; este sourceo no relanza nada.'`,
      'else',
      `  if command -v ${bin} >/dev/null 2>&1; then ct_plan_bin=${CmuxLauncher.RESOLVED}; else ct_plan_bin=${CmuxLauncher.MISSING}; fi`,
      `  printf '%s\\t%s\\t%s\\t%s\\n' ${ShellWord.quote(CmuxLauncher.MAGIC)} ${ShellWord.quote(CmuxLauncher.VERSION)} "$ct_plan_bin" "$PWD" > ${quoted}`,
      '  unset ct_plan_bin',
      `  ${bin} ${ShellWord.quote(errand)}`,
      'fi',
      '',
    ].join('\n')
  }

  static read(text) {
    const line = String(text ?? '').split('\n').find((each) => each.trim().length > 0)
    if (line === undefined) return null
    const fields = line.replace(/\r$/, '').split('\t')
    if (fields.length < 4) return null
    const [magic, version, resolved] = fields
    if (magic !== CmuxLauncher.MAGIC) return null
    if (version !== CmuxLauncher.VERSION) return null
    if (resolved !== CmuxLauncher.RESOLVED && resolved !== CmuxLauncher.MISSING) return null
    const cwd = fields.slice(3).join('\t')
    if (cwd.length === 0) return null

    return { resolved: resolved === CmuxLauncher.RESOLVED, cwd }
  }
}
