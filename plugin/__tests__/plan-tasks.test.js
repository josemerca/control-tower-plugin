// El plan leído como lista de tareas EJECUTABLE (scripts/plan-tasks.js).
//
// La fixture principal NO es la plantilla: es el plan REAL del slice #5 de
// repo-pulse, 534 líneas y 8 tareas, tal y como lo escribió un agente
// despachado. Es deliberado — las tres trampas que este parser esquiva no
// aparecen ni una en `plan-template.md`, así que un test contra la plantilla
// pasaría en verde con un parser roto.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractTasks, stripParenthesised } from '../scripts/plan-tasks.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8')

// Tres backticks en runtime, como en plan-contract.test.js: ninguna línea de
// este fichero puede empezar por un fence real.
const F = '```'

// El plan real tal cual se escribió: su **Verification:** es prosa en línea.
const REAL = fixture('plan-real-issue-5.md')
// El mismo plan con los comandos ya en bloque, que es lo que la regla nueva
// del contrato pide a los planes de ahora en adelante.
const EJECUTABLE = fixture('plan-real-issue-5-ejecutable.md')

const taskOf = (plan, n) => extractTasks(plan).tasks.find((t) => t.n === n)

describe('las tareas del plan', () => {
  it('encuentra las ocho tareas del plan real, numeradas y con nombre', () => {
    const { tasks } = extractTasks(REAL)
    expect(tasks.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(tasks[0].name).toBe('el entorno de test DOM y el proxy de dev')
  })

  it('un texto sin tareas lo dice en vez de devolver una lista vacía y callar', () => {
    const { tasks, problems } = extractTasks('# un plan sin tareas\n')
    expect(tasks).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('tasks')
  })
})

// ---------------------------------------------------------------------------
// TRAMPA 1 — los comandos viven en el bloque cercado, no en la línea
// ---------------------------------------------------------------------------
describe('la vara de la tarea: el bloque de comandos', () => {
  it('saca los comandos del bloque que va detrás de **Verification:**', () => {
    expect(taskOf(EJECUTABLE, 2).commands).toEqual([
      'npm test -w web   # exit 0',
      'npm run build && npm run lint   # exit 0',
    ])
  })

  it('acepta el bloque aunque el párrafo de **Verification:** lleve texto en línea delante', () => {
    // La tarea 1 del plan real dice: "**Verification:** `npm install` y después:"
    // y sólo entonces abre el bloque.
    expect(taskOf(REAL, 1).commands).toEqual([
      'npm test -w web   # exit 0, 1 test',
      'npm run build && npm run lint   # exit 0',
    ])
  })

  it('acepta el bloque aunque el párrafo de **Verification:** ocupe dos líneas', () => {
    // La tarea 8 del plan real ocupa dos líneas antes de terminar el párrafo.
    expect(taskOf(EJECUTABLE, 8).commands).toEqual([
      'npm test && npm run lint && npm run build   # exit 0',
      'test "$(wc -l < AGENTS.md)" -le 150',
    ])
  })

  it('NO confunde el bloque de comandos con los bloques Contract y Current state de la tarea', () => {
    // Las tareas reales llevan sus propios cercados de código citado. Sólo
    // cuenta el que va inmediatamente detrás de **Verification:**, y por eso
    // ninguna tarea del plan ejecutable trae TypeScript entre sus comandos.
    for (const t of extractTasks(EJECUTABLE).tasks) {
      expect(t.commands.every((c) => /^(npm|test|git|node|npx)\b/.test(c))).toBe(true)
    }
  })

  it('el plan REAL no es ejecutable: siete de sus ocho tareas verifican con prosa', () => {
    // Ésta es la medida que justifica la regla nueva del contrato. El plan real
    // es fiel a `plan-template.md` ("**Verification:** {{exact command and
    // expected output}}", en línea), y aun así ningún programa puede ejecutarlo.
    const { problems } = extractTasks(REAL)
    const sinBloque = problems.filter((p) => p.rule === 'verification-block')
    expect(sinBloque.map((p) => p.task)).toEqual([2, 3, 4, 5, 6, 7, 8])
  })

  it('el mismo plan con los comandos en bloque no tiene un solo problema', () => {
    expect(extractTasks(EJECUTABLE).problems).toEqual([])
  })

  it('un bloque de comandos vacío es un problema, no una tarea sin vara', () => {
    const plan = [
      '### Task 1 — vacía',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      '',
      F + 'bash',
      F,
    ].join('\n')
    const { tasks, problems } = extractTasks(plan)
    expect(tasks[0].commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('verification-block')
  })
})

// ---------------------------------------------------------------------------
// TRAMPA 2 — los paréntesis se barren POR PROFUNDIDAD
// ---------------------------------------------------------------------------
describe('los nombres de test', () => {
  it('el paréntesis explicativo con paréntesis dentro no cuela un nombre de test falso', () => {
    // El plan real, tarea 6:
    //   'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es
    //   '0.0,199.0 600.0,199.0')
    // Con un barrido de un solo nivel, `0.0,199.0 600.0,199.0` entra como
    // nombre de test, no existe en ningún fichero y bloquea la tarea con un
    // falso positivo.
    const t6 = taskOf(REAL, 6)
    expect(t6.testsAdded).toEqual([
      'both series share one scale',
      'a zero series sits on the baseline',
      'the area closes on the baseline',
      'the pulse draws the previous window behind the current one',
      'on the full window there is no overlay',
    ])
    expect(t6.testsAdded).not.toContain('0.0,199.0 600.0,199.0')
  })

  it('el barrido de un solo nivel —el que NO vale— sí dejaría pasar el nombre falso', () => {
    // La prueba de que la trampa es real y no una precaución imaginaria.
    const linea = "'a zero series sits on the baseline' (polylinePoints([0, 0], 1) es '0.0,199.0 600.0,199.0')"
    const unNivel = linea.replace(/\([^()]*\)/g, '')
    expect(unNivel).toContain('0.0,199.0 600.0,199.0')
    expect(stripParenthesised(linea)).not.toContain('0.0,199.0 600.0,199.0')
  })

  it('lo que va entre backticks sin comillas simples son identificadores, no tests', () => {
    // La tarea 2 menciona `window=all` y la 6 menciona `pulse-previous`.
    expect(taskOf(REAL, 2).testsAdded).not.toContain('window=all')
    expect(taskOf(REAL, 6).testsAdded).not.toContain('pulse-previous')
    expect(taskOf(REAL, 2).testsAdded).toEqual([
      'lists the clones',
      'asks the summary for the window it is given',
      'surfaces the code of the error envelope',
      'a body that is not the envelope is internal',
    ])
  })

  it('junta la línea de **Tests:** cuando ocupa varias líneas', () => {
    expect(taskOf(REAL, 3).testsAdded).toHaveLength(5)
    expect(taskOf(REAL, 3).testsAdded).toContain('a day ago reads hace 1 día')
  })

  it('"N/A — <razón>" es una declaración legítima: ni añade ni retira', () => {
    for (const n of [4, 8]) {
      expect(taskOf(REAL, n).testsAdded).toEqual([])
      expect(taskOf(REAL, n).testsRemoved).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------
// TRAMPA 3 — el marcador de retirada tiene tres formas
// ---------------------------------------------------------------------------
describe('los tests que la tarea retira a propósito', () => {
  it('parte por "retira a propósito" (la forma del plan real)', () => {
    const t1 = taskOf(REAL, 1)
    expect(t1.testsAdded).toEqual(['renders the app title in a DOM'])
    expect(t1.testsRemoved).toEqual(['App exporta un componente de React'])
  })

  it('parte por "removed on purpose:" (la forma de la plantilla, en inglés)', () => {
    const plan = [
      '### Task 1 — dos formas',
      "**Tests:** added `'el que entra'`; removed on purpose: `'el que sale'`",
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.testsAdded).toEqual(['el que entra'])
    expect(t.testsRemoved).toEqual(['el que sale'])
  })

  it('parte por "retira" a secas', () => {
    const plan = [
      '### Task 1 — forma corta',
      "**Tests:** añade `'el que entra'`; retira `'el que sale'`",
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.testsAdded).toEqual(['el que entra'])
    expect(t.testsRemoved).toEqual(['el que sale'])
  })

  it('sin marcador de retirada, todos los nombres son añadidos', () => {
    expect(taskOf(REAL, 2).testsRemoved).toEqual([])
  })

  it('un test que una tarea retira puede haberlo añadido otra anterior', () => {
    // La tarea 5 del plan real retira el test que añadió la 1. Si el marcador
    // no partiera, ese nombre entraría en la lista de los que DEBEN existir
    // después de la tarea 5: exactamente lo contrario de lo correcto.
    expect(taskOf(REAL, 1).testsAdded).toContain('renders the app title in a DOM')
    expect(taskOf(REAL, 5).testsRemoved).toContain('renders the app title in a DOM')
    expect(taskOf(REAL, 5).testsAdded).not.toContain('renders the app title in a DOM')
  })
})

// ---------------------------------------------------------------------------
// LAS RUTAS QUE EL PLAN DECLARA — **Files:**
// ---------------------------------------------------------------------------
describe('las rutas que la tarea declara en **Files:**', () => {
  it('lee las rutas de **Files:** con su acción', () => {
    // La tarea 1 del plan ejecutable:
    //   **Files:** `web/package.json` (modify), `web/vite.config.ts` (modify),
    //   `web/src/testing/setup.ts` (create), `web/src/App.test.tsx` (modify)
    expect(taskOf(EJECUTABLE, 1).files).toEqual([
      { path: 'web/package.json', action: 'modify' },
      { path: 'web/vite.config.ts', action: 'modify' },
      { path: 'web/src/testing/setup.ts', action: 'create' },
      { path: 'web/src/App.test.tsx', action: 'modify' },
    ])
  })

  it('una ruta sin acción declarada la deja en null', () => {
    const plan = [
      '### Task 1 — sin acción',
      '**Files:** `web/src/App.test.tsx`',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.files).toEqual([{ path: 'web/src/App.test.tsx', action: null }])
  })

  it('una acción que no es "create" ni "modify" también deja la ruta en null', () => {
    // `alcanceDeclarado`, en ct-step.mjs, sólo tiene ramas para 'create' y
    // 'modify'. Un valor distinto ("renombra", un typo, lo que sea) no debe
    // colarse tal cual: se trata como si no hubiera acción declarada.
    const plan = [
      '### Task 1 — acción rara',
      '**Files:** `web/src/App.test.tsx` (renombra)',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.files).toEqual([{ path: 'web/src/App.test.tsx', action: null }])
  })

  it('un párrafo de **Files:** con texto que no rinde ninguna ruta es un problema del plan', () => {
    // Formato incorrecto (sin backticks): `splitFiles` no extrae nada, y sin
    // este aviso `alcanceDeclarado` reportaría TODAS las rutas tocadas como
    // fuera de alcance sin decir por qué.
    const plan = [
      '### Task 1 — sin backticks',
      '**Files:** uno.txt (create)',
      '**Tests:** N/A — nada.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const { tasks, problems } = extractTasks(plan)
    expect(tasks[0].files).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('files-line')
  })

  it('los dos planes reales siguen sin un solo problema de "files-line"', () => {
    expect(extractTasks(REAL).problems.map((p) => p.rule)).not.toContain('files-line')
    expect(extractTasks(EJECUTABLE).problems.map((p) => p.rule)).not.toContain('files-line')
  })
})

// ---------------------------------------------------------------------------
// EL NOMBRE DE TEST QUE DECLARA **TDD:**
// ---------------------------------------------------------------------------
describe('el nombre del test que declara **TDD:**', () => {
  it('lee el nombre del test que declara **TDD:**', () => {
    // La tarea 1 del plan ejecutable: **TDD:** `test('renders the app title in a DOM')` — ...
    expect(taskOf(EJECUTABLE, 1).tddName).toBe('renders the app title in a DOM')
  })

  it('un No TDD no declara ningún test', () => {
    // La tarea 4 dice "No TDD — son los tokens de marca..." y la 8 "No TDD — es documentación...".
    expect(taskOf(EJECUTABLE, 4).tddName).toBeNull()
    expect(taskOf(EJECUTABLE, 8).tddName).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// LAS ETIQUETAS DE ROL DE LOS BLOQUES — Current state / Contract / Call site / Final text
// ---------------------------------------------------------------------------
describe('las etiquetas de rol de los bloques de la tarea', () => {
  it('lee los ficheros que nombra cada etiqueta de rol', () => {
    expect(taskOf(EJECUTABLE, 5).blockPaths).toEqual([
      { role: 'Current state', path: 'web/src/App.tsx' },
      { role: 'Contract', path: 'web/src/Header.tsx' },
    ])
    expect(taskOf(EJECUTABLE, 4).blockPaths).toEqual([
      { role: 'Contract', path: 'web/src/tokens.css' },
      { role: 'Call site', path: 'web/src/main.tsx' },
    ])
    expect(taskOf(EJECUTABLE, 8).blockPaths).toEqual([
      { role: 'Current state', path: 'AGENTS.md' },
      { role: 'Final text', path: 'AGENTS.md' },
    ])
  })

  it('lee el texto literal de un bloque Final text', () => {
    const plan = [
      '### Task 1 — reescribe una nota',
      '**Files:** `docs/nota.md` (modify)',
      'Final text (docs/nota.md):',
      '',
      F + 'md',
      'primera línea',
      'segunda línea',
      F,
      '**TDD:** No TDD — es documentación.',
      '**Tests:** N/A — no hay código nuevo.',
      '**Verification:**',
      F + 'bash',
      'npm test',
      F,
    ].join('\n')
    const t = extractTasks(plan).tasks[0]
    expect(t.finalTexts).toEqual([{ path: 'docs/nota.md', text: 'primera línea\nsegunda línea' }])
  })

  it('extrae íntegro, sin recortar, el Final text (AGENTS.md) de la tarea 8 del plan real', () => {
    // La única prueba de finalTexts hasta ahora era un markdown sintético de
    // dos líneas. La tarea 8 del plan real es el caso de verdad: multilínea,
    // con backticks dentro del propio texto.
    const t8 = taskOf(EJECUTABLE, 8)
    expect(t8.finalTexts).toEqual([
      {
        path: 'AGENTS.md',
        text: [
          '## Frontera `web/` ↔ `server/`',
          'Las abrió el esqueleto (#1) y las cerró el primer slice de UI (#5):',
          '- **En dev, `web/` llega al server por el proxy** — `web/vite.config.ts` encamina',
          '  `/api` a `http://127.0.0.1:3000`. El server no lleva CORS y no debe llevarlo:',
          '  la foto de los repos locales no sale de `127.0.0.1`.',
          '- **`web/` NO importa de `server/`** — los tipos del payload se declaran en',
          '  `web/src/api/types.ts`. Un tipo importado del server puede arrastrar campos de',
          '  autor hasta el DOM, y eso es justo lo que no puede pasar.',
        ].join('\n'),
      },
    ])
  })
})

// Paso 2 del spec de la primera corrida en un repo ajeno: LA VARA TIENE QUE
// PODER MEDIR LO QUE DICE MEDIR.
//
// `verification-block` (5b97fdd) cerró "la verificación es prosa". Queda el
// agujero de al lado, medido en jjponz/rust-monitoring#10: la verificación es
// un comando ejecutable, está en su bloque, y su código de salida dice lo
// CONTRARIO de lo que su comentario dice medir. `ct-step controls` puntúa solo
// por exit code, y `grep -c` sale con 1 cuando no encuentra nada y con 0 cuando
// encuentra: aquel control solo podía ponerse verde en el caso MALO. Ninguna
// implementación podía superarlo, y pasó `--check-plan` y pasó el gate humano.
//
// La regla no adivina intenciones: nombra una lista cerrada de últimos tramos
// cuyo código de salida es DEMOSTRABLEMENTE independiente de lo que el plan
// afirma, y para cada uno dice cómo se escribe el predicado equivalente.
describe('la vara tiene que poder medir lo que dice medir (verification-predicate)', () => {
  const planCon = (comandos) => [
    '### Task 1 — una tarea',
    '',
    '**Objective:** algo.',
    '',
    '**Files:** `a.js` (modify)',
    '',
    '**TDD:** No TDD — configuración.',
    '',
    '**Tests:** N/A — configuración.',
    '',
    '**Verification:** los comandos.',
    '',
    `${F}bash`,
    ...comandos,
    F,
    '',
  ].join('\n')

  const reglas = (comandos) => extractTasks(planCon(comandos)).problems.filter((p) => p.rule === 'verification-predicate')

  it('el control invertido de rust-monitoring, verbatim: `grep -c` cerrando la tubería', () => {
    const r = reglas(["git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0"])
    expect(r).toHaveLength(1)
    expect(r[0].detail).toMatch(/grep -c/)
    expect(r[0].detail).toMatch(/test "\$\(/)
  })

  it('`grep -c` sin tubería tampoco vale: su exit code dice "encontré algo", nunca cuántos', () => {
    expect(reglas(["grep -c '^      - run: cargo ' .github/workflows/ci.yml   # expected: 4"])).toHaveLength(1)
  })

  it('el arreglo SÍ valida: el predicado que envuelve la cuenta, con su tubería dentro de `$(...)`', () => {
    expect(reglas(['test "$(git diff HEAD -- AGENTS.md | grep -c \'ct-init:slices-contract\')" -eq 0'])).toEqual([])
  })

  it('el caso del slice 35 de repo-pulse, verbatim: `grep -c` con DOS ficheros dentro del predicado', () => {
    const r = reglas(['test "$(grep -c \'Cargando…\' web/src/App.tsx web/src/App.test.tsx)" -eq 0'])
    expect(r).toHaveLength(1)
    expect(r[0].detail).toMatch(/dos o más ficheros/)
    expect(r[0].detail).toMatch(/grep -l/)
  })

  it('un fichero dentro del predicado es la forma buena y sigue validando', () => {
    expect(reglas(['test "$(grep -c \'^test(\' web/src/screen.test.ts)" -eq 7'])).toEqual([])
  })

  it('la frontera son dos: con uno vale, con dos no, y da igual que la cuenta sea cero o siete', () => {
    expect(reglas(['test "$(grep -c \'x\' a.ts)" -eq 7'])).toEqual([])
    expect(reglas(['test "$(grep -c \'x\' a.ts b.ts)" -eq 7'])).toHaveLength(1)
    expect(reglas(['test "$(grep -c \'x\' a.ts b.ts c.ts)" -eq 0'])).toHaveLength(1)
  })

  it('con tubería no hay ficheros que contar, aunque el patrón lleve un punto', () => {
    expect(reglas(['test "$(git diff --name-only | grep -c \'web/src/App.tsx\')" -eq 1'])).toEqual([])
  })

  it('los patrones de `-e` no se cuentan como ficheros, o dos patrones y un fichero parecerían dos ficheros', () => {
    expect(reglas(['test "$(grep -c -e p1 -e p2 a.ts)" -eq 0'])).toEqual([])
    expect(reglas(['test "$(grep -c -e p1 a.ts b.ts)" -eq 0'])).toHaveLength(1)
  })

  it('las banderas de grep no se confunden con ficheros', () => {
    expect(reglas(['test "$(grep -cE \'a|b\' --color=never web/src/screen.ts)" -eq 0'])).toEqual([])
  })

  it('`grep -q` y el `grep` pelado no se tocan: ahí el exit code ES la aserción', () => {
    expect(reglas(["grep -q 'cargo clippy' AGENTS.md"])).toEqual([])
    expect(reglas(["grep 'cargo clippy' AGENTS.md"])).toEqual([])
  })

  it('`wc` nunca es un control: sale por 0 con doce líneas y con doce mil — y lo trae el plan real', () => {
    expect(reglas(['wc -l AGENTS.md'])).toHaveLength(1)
  })

  it('`| tail` cierra la tubería con el exit code de tail, no con el del comando que importa', () => {
    expect(reglas(['make check 2>&1 | tail -80'])).toHaveLength(1)
    // Suelto, sobre un fichero, sí asserta algo (que el fichero se puede leer).
    expect(reglas(['tail -5 CHANGELOG.md'])).toEqual([])
  })

  it('`git status` sale por 0 con el árbol sucio y con el árbol limpio', () => {
    expect(reglas(['git status --short   # expected: vacío'])).toHaveLength(1)
  })

  it('un `#` o un `|` entre comillas no son comentario ni tubería', () => {
    expect(reglas(["grep -c '#ct-init' AGENTS.md"])).toHaveLength(1)
    expect(reglas(['grep -q "a|b" AGENTS.md'])).toEqual([])
  })

  it('con `&&`, `||` o `;` no se pronuncia: el exit code depende de qué llegó a correr', () => {
    expect(reglas(['npm test && npm run lint && npm run build   # exit 0'])).toEqual([])
    expect(reglas(['cargo test || wc -l x'])).toEqual([])
  })

  it('el plan real ejecutable sigue sin problemas, con su `wc -l` convertido en predicado', () => {
    expect(extractTasks(EJECUTABLE).problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §3.7-A DEL HANDOFF — "## 8. Global verification" TAMBIÉN TIENE QUE SER
// EJECUTABLE. `ct-step` no ejecutaba ni una línea de esta sección; esto es lo
// que la vuelve una lista de comandos, con la misma vara que ya mide el bloque
// por tarea.
// ---------------------------------------------------------------------------
describe('la Global verification es del programa (§3.7-A)', () => {
  const conTareaY = (bloqueGlobal) => [
    '### Task 1 — una tarea',
    '**Objective:** algo.',
    '**Files:** `a.js` (modify)',
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** ok.',
    F + 'bash',
    'npm test',
    F,
    '',
    ...bloqueGlobal,
    '',
  ].join('\n')

  it('extrae los comandos del primer fence de §8, con prosa antes y después', () => {
    const plan = conTareaY([
      '## 8. Global verification',
      '',
      'Con todo comiteado, desde la raíz:',
      '',
      F + 'bash',
      'npm run build && npm test',
      F,
      '',
      'Para el gate humano: revisa que la UI siga igual.',
    ])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual(['npm run build && npm test'])
    expect(problems.filter((p) => p.rule.startsWith('global-verification'))).toEqual([])
  })

  it('"N/A — <razón>" deja el global sin comandos y sin problema', () => {
    const plan = conTareaY(['## 8. Global verification', '', 'N/A — no hay punta a punta que correr.'])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual([])
    expect(problems.filter((p) => p.rule.startsWith('global-verification'))).toEqual([])
  })

  it('§8 en prosa, sin bloque de comandos, es un problema', () => {
    const plan = conTareaY(['## 8. Global verification', '', 'Que todo siga en verde.'])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('global-verification-block')
  })

  it('un plan sin "## 8." trae el mismo problema', () => {
    const plan = conTareaY([])
    const { global, problems } = extractTasks(plan)
    expect(global.commands).toEqual([])
    expect(problems.map((p) => p.rule)).toContain('global-verification-block')
  })

  it('§8 cuyo último tramo es `wc -l` es un problema de predicado, igual que en una tarea', () => {
    const plan = conTareaY(['## 8. Global verification', '', F + 'bash', 'wc -l AGENTS.md', F])
    const { problems } = extractTasks(plan)
    expect(problems.map((p) => p.rule)).toContain('global-verification-predicate')
  })

  it('el fixture real extrae el único comando de su Global verification', () => {
    const { global } = extractTasks(EJECUTABLE)
    expect(global.commands).toEqual(['npm run build && npm test && npm run lint   # exit 0'])
  })
})
