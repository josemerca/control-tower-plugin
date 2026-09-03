import { isAbsolute } from 'node:path'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'

export class PlanAgentBrief {
  static DOCUMENTS = 'defects.md, style.md, decisions.md, architecture.md, testing.md'
  static NO_NEW_WORKTREES = 'no crees worktrees nuevos'
  static WHITESPACE = /\s+/g
  static EPIC_CONTEXT = 'Contexto del epic'
  static INHERITED_CONTEXT = 'Contexto heredado'

  constructor({ dispatchCheck, conventions, ctStep }) {
    if (typeof dispatchCheck !== 'string' || !isAbsolute(dispatchCheck)) {
      throw new Error(`the errand names dispatch-check by absolute path, got ${JSON.stringify(dispatchCheck)}`)
    }
    if (typeof conventions !== 'string' || !isAbsolute(conventions)) {
      throw new Error(`the errand names where the yardstick lives, got ${JSON.stringify(conventions)}`)
    }
    if (typeof ctStep !== 'string' || !isAbsolute(ctStep)) {
      throw new Error(`the errand names ct-step by absolute path, got ${JSON.stringify(ctStep)}`)
    }
    this.dispatchCheck = dispatchCheck
    this.conventions = conventions
    this.ctStep = ctStep
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
      `Hidrátate del issue: \`gh issue view ${issue.number} --repo ${named}\`. Sus criterios de aceptación y su sección "## Out of scope / Protected" son la entrada del plan.`,
      `Lee también sus secciones "${PlanAgentBrief.EPIC_CONTEXT}" y "${PlanAgentBrief.INHERITED_CONTEXT}": traen lo que condiciona este trabajo y no cabe en los criterios de aceptación. Si están vacías o no aparecen, no hay nada que heredar y no lo busques fuera del issue.`,
      `Lee la vara de Control Tower: los cinco documentos de ${conventions} (${PlanAgentBrief.DOCUMENTS}).`,
      'Esa vara tiene PREFERENCIA sobre las convenciones de este repo, y se mide regla a regla, no por tema: donde una regla del repo manda lo que uno de esos cinco documentos prohíbe, o prohíbe lo que uno manda, no aplica; donde el repo habla de algo de lo que ninguno habla —mayúsculas, prefijos, nombres de fichero—, obliga entera y la sigues. Y la vara del repo no desaparece: la sigues seleccionando en el `Rules to obey:` de la §3 de tu plan. No busques esta regla en el `AGENTS.md` de este repo: puede no traerla, y entonces la que vale es esta línea.',
      'Con una excepción, y es la única regla de la vara que este encargo cambia: la vara de arquitectura se aplica SIEMPRE, también a lo que añadas a un módulo que ya existía y nunca la cumplió. Su cabecera `Applies to: new modules` y su deuda declarada NO valen en este carril —esta línea las pisa—, y eso lo decides al repartir los ficheros de cada tarea.',
      'Escribe el plan con control-tower-loop:writing-plans-prescriptive, usando el issue como spec.',
      `Guárdalo como docs/superpowers/plans/YYYY-MM-DD-issue-${issue.number}-<slug>.md.`,
      `Valídalo con \`node ${dispatchCheck} ${issue.number} --repo ${named} --check-plan\` hasta exit 0.`,
      'Commitéalo: el plan viaja en el pull request, y sin commitear no cuenta como escrito.',
      `Y publícalo como comentario del issue con \`gh issue comment ${issue.number} --repo ${named}\`: es donde una persona lo lee para darte el go o para pedirte cambios, así que sin publicarlo el plan no existe para nadie más que para ti.`,
      `Y entonces PARA. No implementes nada, no abras pull request, no mergees, ${PlanAgentBrief.NO_NEW_WORKTREES}: ya estás en el que te prepararon.`,
    ].join('\n')
  }

  reviewErrandFor({ issueNumber, repository, changes }) {
    if (!(repository instanceof RepositoryName)) {
      throw new Error(`the errand names the repository whose plan it reworks, got ${JSON.stringify(repository)}`)
    }
    const dispatchCheck = this.dispatchCheck
    const named = repository.text

    return [
      `Un humano ha revisado el plan del issue #${issueNumber} que commiteaste y pide cambios:`,
      `«${String(changes).replace(PlanAgentBrief.WHITESPACE, ' ').trim()}».`,
      'Rehaz el plan con esos cambios, sin reescribirlo de cero y sin implementar nada.',
      `Revalídalo con \`node ${dispatchCheck} ${issueNumber} --repo ${named} --check-plan\` hasta exit 0,`,
      'recommitéalo, y publica el plan rehecho como comentario del issue con',
      `\`gh issue comment ${issueNumber} --repo ${named}\`, que es donde se lee para pedir el cambio siguiente.`,
      `Y entonces PARA otra vez: no implementes nada, no abras pull request, ${PlanAgentBrief.NO_NEW_WORKTREES}.`,
    ].join(' ')
  }

  implementationErrandFor({ issueNumber, repository }) {
    const ctStep = this.ctStep
    const dispatchCheck = this.dispatchCheck

    return [
      `El gate \`plan\` del issue #${issueNumber} lo ha cerrado una persona:`,
      'implementa AHORA el plan que commiteaste, sin reescribirlo.',
      `Antes de pedir el primer paso, reescribe en ${SLICE_REL_PATH} los campos role, task y next_action para que digan que estás implementando el plan, no escribiéndolo.`,
      `La secuencia no la conduces con subagent-driven-development ni con su ledger: la dicta la máquina. Pregunta el paso con \`node ${ctStep} next --plan <tu plan de docs/superpowers/plans/> --issue ${issueNumber}\``,
      `y obedece literalmente lo que imprima, tarea a tarea (donde diga \`ct-step\`, es \`node ${ctStep}\`), volviendo a \`next\` tras cada paso hasta que diga "run delivered".`,
      `Entonces abre la pull request con \`Closes #${issueNumber}\` en el cuerpo y libera con`,
      `\`node ${dispatchCheck} ${issueNumber} --repo ${repository.text} --release --no-watch-merge\`, que mueve el issue a revisión.`,
      `Y PARA ahí: no la mergees y ${PlanAgentBrief.NO_NEW_WORKTREES}.`,
    ].join(' ')
  }
}
