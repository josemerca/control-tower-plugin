import { isAbsolute } from 'node:path'
import { RepositoryName } from '../domain/value-objects/repository-name.js'

export class PlanAgentBrief {
  static DOCUMENTS = 'defects.md, style.md, decisions.md, architecture.md, testing.md'

  constructor({ dispatchCheck, conventions }) {
    if (typeof dispatchCheck !== 'string' || !isAbsolute(dispatchCheck)) {
      throw new Error(`the errand names dispatch-check by absolute path, got ${JSON.stringify(dispatchCheck)}`)
    }
    if (typeof conventions !== 'string' || !isAbsolute(conventions)) {
      throw new Error(`the errand names where the yardstick lives, got ${JSON.stringify(conventions)}`)
    }
    this.dispatchCheck = dispatchCheck
    this.conventions = conventions
    Object.freeze(this)
  }

  errandFor({ issue, repository }) {
    if (!(repository instanceof RepositoryName)) {
      throw new Error(`the errand names the repository whose issue it opens, got ${JSON.stringify(repository)}`)
    }
    const dispatchCheck = this.dispatchCheck
    const conventions = this.conventions
    const named = repository.text

    return [
      `Escribes el PLAN del issue #${issue.number} del repo ${named}. No lo implementas.`,
      'Arranque verification-first: confirma pwd, rama y git log, y deja el baseline en verde ANTES de tocar nada.',
      `Hidrátate del issue: \`gh issue view ${issue.number} --repo ${named}\`. Sus criterios de aceptación, su sección "## Out of scope / Protected" y sus decisiones congeladas son la entrada del plan.`,
      `Lee la vara de Control Tower: los cinco documentos de ${conventions} (${PlanAgentBrief.DOCUMENTS}), y el bloque de la vara del \`AGENTS.md\` de este repo, que dice qué manda y en qué orden.`,
      'Escribe el plan con control-tower-loop:writing-plans-prescriptive, usando el issue como spec.',
      `Guárdalo como docs/superpowers/plans/YYYY-MM-DD-issue-${issue.number}-<slug>.md.`,
      `Valídalo con \`node ${dispatchCheck} ${issue.number} --repo ${named} --check-plan\` hasta exit 0.`,
      'Commitéalo: el plan viaja en el pull request, y sin commitear no cuenta como escrito.',
      'Y entonces PARA. No implementes nada, no abras pull request, no mergees, no crees worktrees nuevos: ya estás en el que te prepararon.',
    ].join('\n')
  }
}
