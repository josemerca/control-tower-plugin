// scripts/vara.js
//
// §3.3 del handoff (docs/prompt-juez-lo-que-queda.md): el plan es por slice, así
// que `## 3. Reference patterns` se re-derivaba en cada plan de slice, y nada
// garantizaba que el slice 14 citara las mismas rutas que el slice 3 — trabajo
// re-derivado, y una inconsistencia posible en la vara misma.
//
// Este módulo es la VARA DEL REPO cruzando el embudo de `ct-step` SIN NINGÚN
// AGENTE EN MEDIO: `.agent/conventions.md` lo siembra `scripts/ct-init.sh`, lo
// confirma el humano que corre `/ct-init` (la puerta que ya existía — no se
// añade una cuarta), y `ct-step.mjs` lo lee del disco y lo pega, verbatim, al
// final de cada task brief. `## 3. Reference patterns` del plan sigue
// seleccionando por slice; este fichero declara por repo. El juez mide contra
// la UNIÓN de los dos (ver `agents/ct-judge.md`, ítem `patrones`): si §3 omite
// un documento que el repo declara aquí, la vara llega igual.
//
// OJO, TRAMPA DOCUMENTADA — esto NO es `scripts/conventions.js` ni
// `conventions-io.js`. Esos dos ficheros (785 líneas) van de COLISIONES DE
// PROTOCOLO entre el loop y el repo destino (claim, worktrees, el fichero de
// estado) — un sujeto completamente distinto, con su propio
// `.agent/conventions-ack.md`. Este módulo declara CÓMO SE ESCRIBE CÓDIGO en
// este repo, no cómo conviven el loop y el repo. No lo confundas por el
// nombre.

// La ruta, relativa a la raíz del repo. Una única constante para que
// sembrador, lector y los textos que se lo explican a agentes y humanos no
// puedan divergir en silencio — el mismo desacople que ya sufrieron
// JUDGE_TOOLS y VERDICT_RULES en scripts/step-contracts.js. __tests__/vara.test.js
// ata esta constante a los seis ficheros que la citan.
export const CONVENTIONS_FILE = '.agent/conventions.md'

// seccionDeVara: la sección que `ct-step.mjs` pega al final de cada task
// brief, o `''` si no hay nada que inyectar.
//
// `contenido` es lo que hay HOY en `.agent/conventions.md` (o null/undefined si
// el llamador no llegó a leerlo). Una declaración en blanco (fichero vacío o
// solo espacios) no es vara — es el mismo estado que "el fichero no existe": el
// llamador no escribe nada al brief en ese caso, y el juez sigue midiendo ese
// ítem `sin-vara` en vez de `conforme` (F14: la ausencia se mide, no se
// rellena).
export function seccionDeVara(contenido) {
  if (contenido == null || contenido.trim() === '') return ''
  const cuerpo = contenido.endsWith('\n') ? contenido : `${contenido}\n`
  return `\n---\n\n> La vara del REPO, leída directo de \`.agent/conventions.md\` por el programa —\n> ningún agente la escribió en este brief y el plan no puede quitarla. Sus\n> documentos de reglas son vara igual que los de §3: si §3 omitió uno, se mide\n> también contra él.\n\n${cuerpo}`
}

// ============================================================================
// §3.12 del handoff (docs/prompt-juez-lo-que-queda.md): `reference-paths`
// (scripts/plan-contract.js) prueba que lo que §3 CITÓ existe — caza la
// INVENCIÓN. Nada probaba que §3 citara TODO lo relevante: un
// `docs/conventions/` que sí está en el repo pasaba el validador limpio por
// OMISIÓN, y esa es la asimetría que cierra lo de aquí abajo.
//
// Lo de abajo es un barrido determinista y offline (al estilo
// `discover_conventions.py` de agentic-skills) que PROPONE candidatos a la
// vara de este repo. Su único consumidor es `scripts/detect-vara.mjs`,
// invocado desde `ct-init.sh` en el único momento en que ya hay un humano
// delante. NADA de este código escribe nunca en `.agent/conventions.md`: eso
// sigue siendo, sin excepción, decisión del humano que confirma. Un candidato
// es una PROPUESTA, no una declaración — igual que un semáforo en ámbar no es
// un cruce.
// ============================================================================

export const CANDIDATOS_HEADER =
  'Candidatos a la vara de este repo (barrido determinista — PROPONE, no declara):'
export const MAX_CANDIDATOS = 40
export const MAX_POR_DIRECTORIO = 12

// Guías del repo, EN LA RAÍZ únicamente: un `docs/AGENTS.md` no es la guía
// que herramientas y humanos buscan por convención en la raíz del repo, así
// que no casa aquí (candidatosDeVara sólo aplica esta regla a rutas sin `/`).
const RAIZ_RE = /^(CLAUDE|AGENTS|CONTRIBUTING|CONVENTIONS)(\.md|\.markdown|\.rst|\.txt)?$/i
// Se aplica al BASENAME del directorio (sin la barra final).
const DIR_REGLAS_RE = /(conventions?|convenciones|rules|reglas)/i
const SKILL_PROYECTO_RE = /^\.claude\/skills\/[^/]+\/SKILL\.md$/
const TEXTO_RE = /\.(md|markdown|mdc|rst|txt)$/i
// Nada de lo que vive bajo `.agent/` es candidato: es el terreno del PROPIO
// loop (la declaración misma, `conventions.md`, y el acuse de otro sujeto,
// `conventions-ack.md`) — proponerlo sería el barrido citándose a sí mismo.
const DEL_LOOP_RE = /^\.agent\//
// Determinista y sin depender del locale de la máquina que lo ejecute.
const orden = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// candidatosDeVara: recibe el resultado plano de un recorrido del repo
// (`entradas`, formato `repo-walk.js`: directorios con `/` final) y el
// conjunto de rutas ya declaradas (`declaradasEn`), y devuelve
// `{ candidatos: [{ ruta, motivo }], omitidos }`.
//
// Tres grupos, cada uno ordenado con `orden` para que el resultado sea
// determinista pase lo que pase con el orden del recorrido:
//   1. guías de la raíz (RAIZ_RE);
//   2. ficheros de texto dentro de un directorio cuyo nombre casa
//      "convention(s)|convenciones|rules|reglas" (DIR_REGLAS_RE);
//   3. `SKILL.md` de skills de proyecto (SKILL_PROYECTO_RE).
//
// `MAX_POR_DIRECTORIO` topa cada directorio del grupo 2 por separado —un
// `docs/conventions/` con cien ficheros no debe ahogar a los otros dos
// grupos—, y `MAX_CANDIDATOS` topa la lista entera ya agrupada y ordenada.
// Lo que no cabe por cualquiera de los dos topes cuenta en `omitidos`; lo que
// se descarta por ser del loop o por estar ya declarado NO cuenta ahí: no se
// ha callado, es que no tocaba proponerlo.
export function candidatosDeVara({ entradas = [], declaradas = new Set() } = {}) {
  const vistos = new Set()
  let omitidos = 0

  const admite = (ruta) => {
    if (DEL_LOOP_RE.test(ruta)) return false
    if (declaradas.has(ruta)) return false
    if (vistos.has(ruta)) return false
    return true
  }
  const marcar = (ruta) => vistos.add(ruta)

  const ficheros = entradas.filter((e) => !e.endsWith('/'))
  const directorios = entradas.filter((e) => e.endsWith('/'))

  // Grupo 1 — guías de la raíz.
  const grupoRaiz = ficheros
    .filter((f) => !f.includes('/') && RAIZ_RE.test(f))
    .sort(orden)
    .filter((f) => admite(f))
    .map((ruta) => (marcar(ruta), { ruta, motivo: 'guía del repo en la raíz' }))

  // Grupo 2 — ficheros de texto dentro de directorios que casan "reglas".
  const grupoDirectorios = []
  const dirsQueCasan = directorios
    .filter((d) => DIR_REGLAS_RE.test(d.slice(0, -1).split('/').pop()))
    .sort(orden)
  for (const dir of dirsQueCasan) {
    const candidatosDelDir = ficheros
      .filter((f) => f.startsWith(dir) && TEXTO_RE.test(f))
      .sort(orden)
      .filter((f) => admite(f))
    const admitidos = candidatosDelDir.slice(0, MAX_POR_DIRECTORIO)
    omitidos += Math.max(0, candidatosDelDir.length - MAX_POR_DIRECTORIO)
    for (const ruta of admitidos) {
      marcar(ruta)
      grupoDirectorios.push({ ruta, motivo: `dentro de \`${dir}\`, que casa convention|rules` })
    }
  }

  // Grupo 3 — skills de proyecto.
  const grupoSkills = ficheros
    .filter((f) => SKILL_PROYECTO_RE.test(f))
    .sort(orden)
    .filter((f) => admite(f))
    .map((ruta) => (marcar(ruta), {
      ruta,
      motivo: 'skill de proyecto (también se puede declarar por nombre en la lista `Skills`)',
    }))

  let candidatos = [...grupoRaiz, ...grupoDirectorios, ...grupoSkills]
  if (candidatos.length > MAX_CANDIDATOS) {
    omitidos += candidatos.length - MAX_CANDIDATOS
    candidatos = candidatos.slice(0, MAX_CANDIDATOS)
  }
  return { candidatos, omitidos }
}

// declaradasEn: el conjunto de rutas que `.agent/conventions.md` YA declara
// hoy — todo lo que aparezca entre backticks simples, normalizado (sin `./`
// inicial ni `/` final).
//
// La semilla que siembra `ct-init.sh` no lleva ningún backtick, así que un
// repo recién bootstrapeado devuelve el conjunto vacío y `candidatosDeVara`
// propone TODO lo que encuentre — es la conducta buscada (F14: la ausencia se
// mide, no se rellena; aquí, "nada declarado" no debe leerse como "nada que
// proponer"). Y un DIRECTORIO declarado (p.ej. `docs/conventions/`) no
// suprime sus ficheros: una ruta acabada en `/` no es una ruta legible, así
// que seguir proponiendo los ficheros de dentro es la corrección, no el
// ruido — el humano decidirá si esa declaración ya cubre el directorio o si
// hace falta declarar los ficheros uno a uno.
export function declaradasEn(contenido) {
  const out = new Set()
  for (const m of String(contenido ?? '').matchAll(/`([^`\n]+)`/g)) {
    let token = m[1].trim()
    if (!token) continue
    if (token.startsWith('./')) token = token.slice(2)
    token = token.replace(/\/+$/, '')
    if (token) out.add(token)
  }
  return out
}

// Los mismos marcadores que `scripts/ct-init.sh` usa para delimitar el
// bloque "Formato de la tabla de slices" que él mismo inyecta en AGENTS.md.
// Se duplican aquí como literal, igual que ya hacen de forma independiente
// `scripts/conventions.js` (CONTRACT_MARKER_OPEN/CLOSE) y
// `scripts/governed-repo.js` (CONTRACT_MARKER) — cada módulo que necesita
// reconocer este bloque lleva su propia copia del literal en vez de importar
// entre módulos de sujetos distintos (conventions.js es OTRO sujeto:
// colisiones de protocolo, no la vara de código).
//
// Por qué hace falta aquí: el AGENTS.md que `ct-init.sh` CREA de cero no se
// queda en "solo encabezados" — el propio script le añade SIEMPRE esta
// sección de proceso (el contrato de la tabla de slices con `/ct-groom`,
// cientos de líneas de prosa real). Esa sección es sustancia de verdad, pero
// no es una CONVENCIÓN DE CÓDIGO: es el formato que consume `/ct-groom`, no
// una regla de estilo del repo. Sin descontarla, `pareceEsqueleto` vería
// sobrada sustancia y jamás marcaría el AGENTS.md recién creado — que es
// justo el caso que motiva esta función.
//
// Y el mismo razonamiento, palabra por palabra, vale para el SEGUNDO bloque
// que `ct-init.sh` inyecta desde la feature del e2e al cierre del slice: la
// sección "Cómo se atraviesa este repo (e2e)". Se siembra como PLANTILLA con
// sus campos vacíos (`Levantar:`, `Listo cuando:`…), que son media docena de
// líneas con sustancia formal y cero contenido real — sin descontarla, el
// AGENTS.md recién creado dejaría de parecer esqueleto por culpa de unos
// campos que nadie ha rellenado todavía. Tampoco es una convención de código:
// es cómo se levanta el repo, que es lo que consume el paso `e2e` de
// `ct-step`.
const CT_INIT_BLOCKS = [
  ['<!-- ct-init:slices-contract -->', '<!-- /ct-init:slices-contract -->'],
  ['<!-- ct-init:e2e-howto -->', '<!-- /ct-init:e2e-howto -->'],
]

function sinBloquesDeCtInit(contenido) {
  const lineas = String(contenido ?? '').split('\n')
  const out = []
  let cierreEsperado = null
  for (const raw of lineas) {
    const linea = raw.replace(/\r$/, '')
    if (cierreEsperado === null) {
      const bloque = CT_INIT_BLOCKS.find(([abre]) => linea === abre)
      if (bloque) { cierreEsperado = bloque[1]; continue }
      out.push(raw)
      continue
    }
    if (linea === cierreEsperado) cierreEsperado = null
  }
  return out.join('\n')
}

// pareceEsqueleto: aproximación deliberada, no un parser de markdown — cuenta
// líneas "con sustancia" (no vacías, que no empiecen por `#` y que no sean un
// comentario HTML de una sola línea), DESCONTANDO antes el bloque del
// contrato de slices que `ct-init.sh` inyecta (ver arriba), y dice esqueleto
// si hay MENOS de 3.
//
// Sirve para lo único que tiene que servir: distinguir el `AGENTS.md` de solo
// encabezados que `ct-init` acaba de crear (candidato real, pero sin ninguna
// regla dentro) de un documento con reglas de verdad — y DECIRLO, no
// filtrarlo. Declarar el esqueleto como vara pone al juez a medir contra un
// documento vacío y a devolver `conforme` sin serlo: es el guard imposible de
// F14 con otro nombre. Un comentario HTML multilínea cuenta por dentro (sus
// líneas internas no empiezan por `<!--` ni acaban en `-->`) — aceptado: es
// una aproximación, no una prueba formal.
export function pareceEsqueleto(contenido) {
  const lineas = sinBloquesDeCtInit(contenido).split('\n')
  let sustancia = 0
  for (const linea of lineas) {
    const t = linea.trim()
    if (!t) continue
    if (t.startsWith('#')) continue
    if (t.startsWith('<!--') || t.endsWith('-->')) continue
    sustancia++
  }
  return sustancia < 3
}

// formatCandidatos: el bloque de texto listo para stdout de `ct-init.sh`, o
// `''` si no hay nada que proponer (silencio = nada que proponer; ver el
// comentario de `declaradasEn` sobre por qué eso es benigno).
//
// Indentación de dos espacios en el detalle, igual que `formatFindings` en
// `conventions.js`. Deliberadamente SIN las palabras "aviso" ni "ATENCIÓN" ni
// "unblock": esto no es una alarma sobre un conflicto (eso es
// `detect-conventions.mjs`), es material para una decisión — y
// `__tests__/ct-init.test.js` exige que la segunda corrida de un repo
// bootstrapeado no traiga la palabra "aviso" por stderr, corrida en la que
// este bloque SÍ tiene candidato (el `AGENTS.md` que `ct-init` acaba de
// crear).
export function formatCandidatos(candidatos, { omitidos = 0, truncated = false } = {}) {
  if (!candidatos || candidatos.length === 0) return ''
  const out = [CANDIDATOS_HEADER]
  let hayEsqueleto = false
  for (const c of candidatos) {
    const marca = c.esqueleto ? ' [esqueleto: sólo encabezados]' : ''
    if (c.esqueleto) hayEsqueleto = true
    out.push(`  · \`${c.ruta}\` — ${c.motivo}${marca}`)
  }
  out.push(
    '  Nada de esto se ha escrito por ti: el barrido PROPONE y el humano DECLARA. ' +
      `Enséñaselos al usuario y escribe en \`${CONVENTIONS_FILE}\` SOLO los que confirme.`
  )
  if (hayEsqueleto) {
    out.push(
      '  Los marcados `[esqueleto: sólo encabezados]` no traen reglas todavía: declararlos hoy ' +
        'pondría al juez a medir contra un documento vacío y a devolver `conforme` sin serlo. ' +
        'La ausencia se mide (`sin-vara`), no se rellena.'
    )
  }
  if (omitidos > 0) {
    out.push(`  (+${omitidos} candidatos más, no listados: la lista es para que la filtre una persona.)`)
  }
  if (truncated) {
    out.push(
      '  nota: el recorrido del repo se cortó por sus cotas, así que puede haber candidatos que no ' +
        'se hayan mirado. Ausencia aquí no es prueba de ausencia.'
    )
  }
  return out.join('\n')
}
