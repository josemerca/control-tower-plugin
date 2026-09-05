import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'
import { PluginYardstick } from '../../../plugin/scripts/plugin-yardstick.js'

export class PlanAgentBrief {
  static NO_NEW_WORKTREES = 'no crees worktrees nuevos'
  static WHITESPACE = /\s+/g
  static EPIC_CONTEXT = 'Contexto del epic'
  static INHERITED_CONTEXT = 'Contexto heredado'

  constructor({ dispatchCheck, conventions, ctStep }) {
    this.dispatchCheck = dispatchCheck
    this.conventions = conventions
    this.ctStep = ctStep
    Object.freeze(this)
  }

  errandFor({ issue, repository }) {
    const dispatchCheck = this.dispatchCheck
    const conventions = this.conventions
    const named = repository.text

    return [
      `Escribes el PLAN del issue #${issue.number} del repo ${named}. No lo implementas.`,
      'Arranque verification-first: confirma pwd, rama y git log, y deja el baseline en verde ANTES de tocar nada.',
      `Hidrátate del issue: \`gh issue view ${issue.number} --repo ${named}\`. Sus criterios de aceptación y su sección "## Out of scope / Protected" son la entrada del plan.`,
      `Lee también sus secciones "${PlanAgentBrief.EPIC_CONTEXT}" y "${PlanAgentBrief.INHERITED_CONTEXT}": traen lo que condiciona este trabajo y no cabe en los criterios de aceptación. Si están vacías o no aparecen, no hay nada que heredar y no lo busques fuera del issue.`,
      `La vara de Control Tower vive en ${conventions} y el programa la lleva a cada tarea: al implementador pegada, al juez por ruta. Lo que tu plan selecciona es la vara del REPO, en el \`Rules to obey:\` de su §3; de ${conventions} abre el documento que necesites para decidir algo concreto, no los cinco por delante.`,
      'Cómo se relacionan las dos cuando chocan lo dice la cabecera con la que esa vara viaja, y va aquí entera porque el `AGENTS.md` de este repo puede no traerla. Es el único sitio donde esa regla está escrita: aplícala tal cual, no la reinterpretes ni la reescribas en tu plan.',
      PluginYardstick.precedenceHeader(),
      'Escribe el plan con control-tower-loop:writing-plans-prescriptive, usando el issue como spec.',
      `Guárdalo como docs/superpowers/plans/YYYY-MM-DD-issue-${issue.number}-<slug>.md.`,
      `Valídalo con \`node ${dispatchCheck} ${issue.number} --repo ${named} --check-plan\` hasta exit 0.`,
      'Commitéalo: el plan viaja en el pull request, y sin commitear no cuenta como escrito.',
      `Y publícalo como comentario del issue con \`gh issue comment ${issue.number} --repo ${named}\`: es donde una persona lo lee para darte el go o para pedirte cambios, así que sin publicarlo el plan no existe para nadie más que para ti.`,
      `Y entonces PARA. No implementes nada, no abras pull request, no mergees, ${PlanAgentBrief.NO_NEW_WORKTREES}: ya estás en el que te prepararon.`,
    ].join('\n')
  }

  reviewErrandFor({ issueNumber, repository, changes }) {
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
