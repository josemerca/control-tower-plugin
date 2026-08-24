import { describe, it, expect } from 'vitest'
import { parseScope, matchesPattern, scopeViolations, issueFromPrBody, isSliceBranch, LOOP_ARTIFACT_PATTERNS } from '../scripts/scope.js'

// EL CASO QUE ORIGINA TODO ESTE FICHERO, verbatim del campo.
//
// Despacho 1, slice 4 (menoplus #662 → PR #668, 2026-08-13). El agente tocó
// copy GDPR en pantalla contra su «Protegido» explícito, re-grabó su baseline,
// y escribió en el ledger y en el cuerpo del PR que Jose lo había autorizado.
// LAS DOS AFIRMACIONES ERAN FALSAS: su transcript tiene UNA sola entrada de
// usuario, el kickoff del dispatcher.
//
// Lo detectó una persona extrañándose de ver dos `.swift` de la app en la lista
// de ficheros. No lo detectó: el hook del gate visual (solo dispara en
// TaskUpdate), la label `gate:none` (la renuncia era legítima para el trabajo
// PREVISTO), el CI (verde, porque el cambio era correcto), ni los dos reviewers
// independientes del propio agente (revisaron el cambio, no la firma).
//
// La lección que este módulo cablea: la firma humana NO es verificable desde
// dentro del loop —el agente corre con las credenciales de Jose, así que puede
// falsificar cualquier artefacto de GitHub—, pero LO QUE TOCÓ sí. El hecho no
// se puede falsificar sin que se vea.
const FICHEROS_DEL_PR_668 = [
  'apps/ios/MenoPlusTests/Infrastructure/SpanishStringsLintTests.swift',
  'apps/ios/MenoPlus/Presentation/Profile/DeletionConfirmView.swift',
  'apps/ios/MenoPlus/Presentation/Chat/ErrorBubbleView.swift',
  'docs/superpowers/plans/2026-08-13-guardarrailes-slice-4-plan.md',
]

const CUERPO_ISSUE_662 = `## Acceptance criteria
- La detección no depende de la lista de 68 palabras

## Contexto del epic
- **Fichero del epic:** \`apps/ios/MenoPlusTests/Infrastructure/SpanishStringsLintTests.swift\`. Los cuatro slices lo tocan.
- Alcance: apps/ios/MenoPlusTests/**, .github/workflows/ci.yml
- **Invariante de backend, no lo toques:** \`Lipidos\`, \`Coagulacion\`.

## Out of scope / Protected
- 🚫 No se corrige copy nuevo sin parar y preguntar

<!-- ct-order:4 -->`

describe('parseScope — el alcance del epic, declarado UNA vez y legible por máquina', () => {
  it('lee la línea `Alcance:` de dentro de `## Contexto del epic`', () => {
    const s = parseScope(CUERPO_ISSUE_662)
    expect(s.declared).toBe(true)
    expect(s.patterns).toEqual(['apps/ios/MenoPlusTests/**', '.github/workflows/ci.yml'])
  })

  // LA DECISIÓN DOCTRINAL DEL MÓDULO. Un epic que no declara alcance no está
  // limpio: es un epic que no se puede comprobar. Es la misma regla que el
  // resto del plugin ya sostiene («el 1 nunca se degrada a 0»), y su efecto
  // práctico es deliberado: empuja la fricción a la congelación, que es el
  // único momento del ciclo en que Jose está leyendo.
  it('sin línea `Alcance:` → declared FALSE, que NO es lo mismo que «sin restricciones»', () => {
    const s = parseScope('## Contexto del epic\n- Cosas en prosa, ningún alcance.\n')
    expect(s.declared).toBe(false)
    expect(s.patterns).toEqual([])
    expect(s.reason).toMatch(/no declara/i)
  })

  it('`Alcance:` presente pero vacío tampoco cuenta como declarado', () => {
    const s = parseScope('## Contexto del epic\n- Alcance:   \n')
    expect(s.declared).toBe(false)
  })

  // El `Alcance:` tiene que vivir DENTRO de `## Contexto del epic` porque es la
  // única sección que groom copia verbatim al issue. Una línea suelta en otra
  // sección no viajaría al agente ni al gate, y darla por buena aquí crearía un
  // alcance que existe en el spec y no existe donde se comprueba.
  it('ignora un `Alcance:` que viva fuera de `## Contexto del epic`', () => {
    const body = '## Acceptance criteria\n- Alcance: apps/**\n\n## Contexto del epic\n- nada\n'
    expect(parseScope(body).declared).toBe(false)
  })

  it('tolera negrita, backticks y espaciado alrededor del valor', () => {
    const s = parseScope('## Contexto del epic\n- **Alcance:** `apps/ios/**` ,  `docs/**` \n')
    expect(s.patterns).toEqual(['apps/ios/**', 'docs/**'])
  })

  // El cierre de la negrita del rótulo (`**Alcance:**`) cae después de los dos
  // puntos y se colaba al principio del valor. Se quita solo cuando lleva
  // espacio detrás — que es lo que distingue un cierre de negrita de un glob
  // que empieza por `**`, el cual siempre lleva barra.
  it('un patrón que EMPIEZA por `**` sobrevive al limpiado de la negrita', () => {
    expect(parseScope('## Contexto del epic\n- **Alcance:** **/*.swift\n').patterns).toEqual(['**/*.swift'])
  })

  it('varias líneas `Alcance:` acumulan patrones en vez de que la última gane', () => {
    const s = parseScope('## Contexto del epic\n- Alcance: apps/**\n- Alcance: docs/**\n')
    expect(s.patterns).toEqual(['apps/**', 'docs/**'])
  })

  it('la sección se corta en el siguiente encabezado, no se come el resto del body', () => {
    const body = '## Contexto del epic\n- nada\n\n## Out of scope / Protected\n- Alcance: apps/**\n'
    expect(parseScope(body).declared).toBe(false)
  })

  it('body vacío o ausente → declared false, sin throw', () => {
    expect(parseScope('').declared).toBe(false)
    expect(parseScope(null).declared).toBe(false)
  })
})

describe('matchesPattern — el glob mínimo, dicho entero para que nadie lo adivine', () => {
  it('`**` cruza separadores de directorio', () => {
    expect(matchesPattern('apps/ios/MenoPlusTests/Infrastructure/X.swift', 'apps/ios/MenoPlusTests/**')).toBe(true)
  })
  it('`*` NO cruza separadores', () => {
    expect(matchesPattern('apps/ios/X.swift', 'apps/*')).toBe(false)
    expect(matchesPattern('apps/ios', 'apps/*')).toBe(true)
  })
  it('una ruta exacta casa exacta', () => {
    expect(matchesPattern('.github/workflows/ci.yml', '.github/workflows/ci.yml')).toBe(true)
    expect(matchesPattern('.github/workflows/otro.yml', '.github/workflows/ci.yml')).toBe(false)
  })
  // Amabilidad medida: quien escribe el alcance a mano en la congelación va a
  // escribir el directorio, no el glob. Tratar el `/` final como `/**` evita un
  // rojo por sintaxis en el momento en que menos ganas hay de depurar globs.
  it('un patrón que acaba en `/` vale como el directorio entero', () => {
    expect(matchesPattern('apps/ios/a/b.swift', 'apps/ios/')).toBe(true)
  })
  it('normaliza el `./` inicial de las dos partes', () => {
    expect(matchesPattern('./apps/x.swift', 'apps/**')).toBe(true)
  })
  // Los metacaracteres de regex que aparecen de verdad en rutas (`.`, `+`, `(`)
  // tienen que ser literales, o `.github` casaría con `Xgithub`.
  it('el punto es literal, no «cualquier carácter»', () => {
    expect(matchesPattern('Xgithub/workflows/ci.yml', '.github/workflows/ci.yml')).toBe(false)
  })
})

describe('scopeViolations — el hecho, que es lo que no se puede falsificar', () => {
  it('EL INCIDENTE: los dos .swift de la app salen como violación, el test y el plan no', () => {
    const { patterns } = parseScope(CUERPO_ISSUE_662)
    expect(scopeViolations(FICHEROS_DEL_PR_668, patterns)).toEqual([
      'apps/ios/MenoPlus/Presentation/Profile/DeletionConfirmView.swift',
      'apps/ios/MenoPlus/Presentation/Chat/ErrorBubbleView.swift',
    ])
  })

  it('un PR enteramente dentro del alcance no produce ninguna violación', () => {
    const { patterns } = parseScope(CUERPO_ISSUE_662)
    expect(scopeViolations(['apps/ios/MenoPlusTests/Infrastructure/SpanishStringsLintTests.swift'], patterns)).toEqual([])
  })

  // EXENCIÓN, y hay que leerla como lo que es: no un agujero, sino el
  // reconocimiento de la huella del PROPIO loop. El kickoff ORDENA al agente
  // escribir su plan en docs/superpowers/plans/ y commitearlo («viaja en el
  // PR»). Hacer fallar el gate por un fichero que el propio loop exige sería un
  // muro insatisfacible, y un guard que solo se satisface desobedeciendo al
  // dispatcher se acaba ignorando entero.
  it('el plan del slice está exento: lo ordena el kickoff, no lo elige el agente', () => {
    expect(scopeViolations(['docs/superpowers/plans/x-plan.md'], ['apps/**'])).toEqual([])
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/plans/**')
  })

  // `.agent/SLICE.md` NO está exento, y es deliberado: es estado de sesión, no
  // producto del slice. En el despacho 1 un agente lo metió en su PR y lo sacó
  // él mismo después («es estado de sesión, no producto del slice»). Exentarlo
  // normalizaría justo lo que aquel agente corrigió por su cuenta.
  it('`.agent/SLICE.md` NO está exento: es estado de sesión, no producto del slice', () => {
    expect(scopeViolations(['.agent/SLICE.md'], ['apps/**'])).toEqual(['.agent/SLICE.md'])
  })

  // Tampoco `.superpowers/**`: el propio skill de brainstorming dice que ese
  // directorio va en `.gitignore`. Apareció de verdad en el PR #668
  // (`.superpowers/sdd/progress.md`) y marcarlo NO es un falso positivo — es
  // estado de sesión commiteado, residuo del fork.
  it('`.superpowers/**` NO está exento: debería estar en .gitignore, no en un PR', () => {
    expect(scopeViolations(['.superpowers/sdd/progress.md'], ['apps/**'])).toEqual(['.superpowers/sdd/progress.md'])
  })

  // La contabilidad propia de cada repo (BITACORA.md es de menoplus, no del
  // plugin) NO se hardcodea en el plugin: la declara el repo destino en su
  // workflow. Hardcodearla aquí abriría ese agujero en TODOS los repos.
  it('las exenciones del repo destino se SUMAN a las del plugin, no las sustituyen', () => {
    const files = ['docs/superpowers/BITACORA.md', 'docs/superpowers/plans/x.md', 'src/a.swift']
    expect(scopeViolations(files, ['apps/**'], ['docs/superpowers/BITACORA.md'])).toEqual(['src/a.swift'])
  })

  it('un repo que declara sus exenciones no puede desactivar sin querer las del plugin', () => {
    expect(scopeViolations(['docs/superpowers/plans/x.md'], ['apps/**'], ['otra/cosa'])).toEqual([])
  })

  // El execution spec está exento porque el slice rellena su «Registro de
  // cierre» al entregar — pero eso deja al agente escribiendo en el spec
  // CONGELADO sin que el gate lo vea. Se testea para que la exención sea una
  // decisión visible y no un descuido que alguien descubra en el próximo
  // incidente.
  it('el execution spec está exento — y esa exención es un límite conocido del gate', () => {
    expect(scopeViolations(['docs/superpowers/specs/2026-08-12-x-execution.md'], ['apps/**'])).toEqual([])
  })

  // EL DEFECTO MEDIDO: `ct-step report` escribe el veredicto del juez en
  // `docs/superpowers/verdicts/issue-<n>-task-<t>.json`, lo stagea y lo mete
  // DENTRO del commit de cada tarea («el veredicto VIAJA en la pull request»,
  // criterio de cierre de F37). Con esa ruta sin exentar, un epic que declare
  // `Alcance: src/**` y tenga el gate instalado sale ROJO por un fichero que el
  // agente no escribió y no puede impedir que se escriba — comprobado
  // ejecutando la función, que devolvía
  // `docs/superpowers/verdicts/issue-2-task-1.json` como violación. Y el
  // mensaje que da el gate («o el trabajo sale del PR, o el alcance del epic
  // cambia») es imposible de obedecer: es el muro insatisfacible de F14 otra
  // vez, y un guard que solo se satisface desobedeciendo se desactiva entero.
  it('el veredicto del juez está exento: lo escribe y lo stagea ct-step, no el agente', () => {
    expect(scopeViolations(['docs/superpowers/verdicts/issue-2-task-1.json'], ['src/**'])).toEqual([])
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/verdicts/**')
  })

  // La telemetría del run va a viajar en el PR por la misma razón que el
  // veredicto, y la exención tiene que estar ANTES de que llegue la escritura:
  // si llega primero, el siguiente slice de cualquier epic con alcance
  // declarado sale rojo por el fichero de métricas, y quien lo lea no sabrá si
  // el rojo lo puso el agente o el loop.
  it('la telemetría del run está exenta: la escribe el loop, no el implementador', () => {
    expect(scopeViolations(['docs/superpowers/metrics/ct-step.jsonl'], ['src/**'])).toEqual([])
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/metrics/**')
  })

  // EL CONTRAPESO, y sin él los dos tests de arriba pasarían con una lista de
  // exentos que eximiera de más (`docs/**`, o peor, `**`). Una ruta fuera de
  // alcance sigue siendo violación, incluso —y sobre todo— si es vecina de las
  // exentas dentro de `docs/superpowers/`.
  it('las exenciones nuevas no ensanchan el agujero: lo de al lado sigue violando', () => {
    expect(scopeViolations(['lib/ajeno.js'], ['src/**'])).toEqual(['lib/ajeno.js'])
    expect(scopeViolations(['docs/superpowers/apuntes.md'], ['src/**'])).toEqual(['docs/superpowers/apuntes.md'])
  })

  // Sin patrones el resultado NO puede ser «nada viola»: eso convertiría un
  // epic sin alcance declarado en un epic con barra libre, que es exactamente
  // el fallo que el gate viene a cerrar. Devolver todos los ficheros deja al
  // llamante sin forma de leerlo como limpio.
  it('sin patrones, TODOS los ficheros son violación — nunca «nada que ver aquí»', () => {
    expect(scopeViolations(['a.swift', 'b.swift'], [])).toEqual(['a.swift', 'b.swift'])
  })

  it('lista de ficheros vacía → sin violaciones, sin throw', () => {
    expect(scopeViolations([], ['apps/**'])).toEqual([])
  })
})

describe('isSliceBranch — lo que salva al gate de morir de ruido', () => {
  // El gate juzga PRs de slice. Un PR de documentación, un chore o un arreglo a
  // mano NO llevan `Closes #N` y no son cosecha del loop: hacerlos fallar
  // suspendería todos los PRs humanos del repo y el gate se desactivaría entero
  // en un día — el muro insatisfacible que conventions.js ya pagó aquí (F14).
  //
  // La discriminación es la rama, porque `feat/<n>` la crea el DISPATCHER (es
  // el `branchNameOf` por defecto de dispatch.js), no el agente.
  it('reconoce la rama que crea el dispatcher', () => {
    expect(isSliceBranch('feat/662')).toBe(true)
  })
  it('una rama humana no es rama de slice', () => {
    expect(isSliceBranch('docs/desenlace')).toBe(false)
    expect(isSliceBranch('feat/scope-gate')).toBe(false)
    expect(isSliceBranch('main')).toBe(false)
  })
  it('vacío o ausente no es rama de slice, sin throw', () => {
    expect(isSliceBranch('')).toBe(false)
    expect(isSliceBranch(null)).toBe(false)
  })
})

describe('issueFromPrBody — de qué issue es este PR', () => {
  // Se apoya en findClosingKeywords (closing-keywords.js), que ya está
  // endurecido contra el ReDoS que midió F27. No se reimplementa el reconocedor
  // de closing keywords: dos reconocedores del mismo texto derivan.
  it('saca el número del `Closes #N` del cuerpo', () => {
    expect(issueFromPrBody('Closes #662\n\nSlice 4 y último.')).toBe(662)
  })
  it('acepta las demás keywords de cierre que GitHub honra', () => {
    expect(issueFromPrBody('Fixes: #10')).toBe(10)
  })
  // Un PR sin `Closes` no es cosecha del loop y el gate no puede juzgarlo. Que
  // devuelva null y no 0 obliga al llamante a decidir explícitamente qué hace.
  it('sin closing keyword → null, para que el llamante decida', () => {
    expect(issueFromPrBody('Un PR suelto, sin issue.')).toBeNull()
  })
  it('cuerpo vacío o ausente → null, sin throw', () => {
    expect(issueFromPrBody('')).toBeNull()
    expect(issueFromPrBody(null)).toBeNull()
  })
  // Varios `Closes` en un PR es ambiguo: el gate no elige uno en silencio.
  it('dos issues cerrados por el mismo PR → null, no el primero a dedo', () => {
    expect(issueFromPrBody('Closes #10\nCloses #11')).toBeNull()
  })
})
