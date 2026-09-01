export class SliceSeed {
  static RELATIVE_PATH = '.agent/SLICE.md'
  static DIRECTORY = '.agent'
  static EXCLUDE_PATH = 'info/exclude'
  static EXCLUDE_RULE = SliceSeed.RELATIVE_PATH

  static textFor({ issue, branch, base, cut }) {
    return [
      '---',
      `task: "escribir el plan del issue #${issue.number}"`,
      'role: "slice-agent: escribes el plan de este slice contra el código real y PARAS. No implementas nada."',
      'status: in_progress',
      `branch: "${branch}"`,
      `base: "${base}"`,
      `base_sha: "${cut}"`,
      `last_commit: "${cut}"`,
      `github_issue: ${issue.number}`,
      'you_are_here: "worktree recién cortado, sin trabajo encima"',
      'next_action: "escribe el plan prescriptivo, valídalo con --check-plan, commitéalo y para"',
      'blocked: null',
      '---',
      '',
      `Estado del slice del issue #${issue.number}. Lo sembró el backend de Control Tower al abrir esta sesión.`,
      '',
      'Este fichero está fuera de la vista de git a propósito: no puede entrar en el pull request.',
      '',
    ].join('\n')
  }
}
