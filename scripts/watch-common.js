// ============================================================================
// LO QUE COMPARTEN LOS DOS VIGILANTES, y que estaba copiado verbatim.
//
// `ct-watch-go.mjs` y `ct-watch-merge.mjs` son hermanos a propósito: uno vigila
// el `-OK` del gate `plan` y el otro el merge del PR, y se leen en paralelo
// porque las divergencias entre ellos se ven precisamente cuando todo lo demás
// es idéntico. Eso vale para su ESTRUCTURA. No valía para esto: el parseo de
// argv, la apertura del log, el `plazo()` que aborta ante un valor ilegible y el
// `sleep` no tenían dos versiones porque nadie hubiera decidido dos cosas — las
// tenían porque el segundo fichero nació copiando el primero.
//
// Lo señaló una revisión adversarial sobre la #37, y de sus dos mitades ésta es
// la barata: la cara es que el recorrido de cmux también estaba copiado, y ahí sí
// había una divergencia con consecuencias (ver scripts/cmux.js).
//
// LOS DOS PLAZOS SIGUEN SIENDO DE CADA UNO. Este módulo comparte el MECANISMO
// (`plazo`, que lee una variable de entorno y aborta si no se entiende), nunca
// los NÚMEROS: el vigilante del `-OK` sondea cada 30 s durante 8 h porque cubre
// que una persona esté durmiendo, y el del merge cada 60 s durante 48 h porque
// cubre que un PR espere revisión, que se cuenta en días. Fundirlos aquí sería
// convertir dos decisiones medidas en una constante compartida que nadie vuelve
// a mirar.
// ============================================================================

import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseStrictInt } from './argnum.js'

// `--nombre valor` de un argv plano. No hay parser de opciones a propósito: son
// cuatro banderas y una dependencia menos en un proceso que corre desprendido.
export function arg(argv, nombre) {
  const i = argv.indexOf(nombre)
  return i === -1 ? null : argv[i + 1] ?? null
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// UN PLAZO QUE NO SE ENTIENDE ABORTA, no cae al defecto en silencio. Mismo
// criterio que CT_NEXT_LAUNCH_TIMEOUT_MS, y por el mismo motivo: un plazo mal
// escrito cambia lo que el proceso SIGNIFICA, y no querrías descubrirlo ocho
// horas (o dos días) después mirando por qué nadie te avisó.
export function plazo(nombre, defecto) {
  const raw = process.env[nombre]
  if (raw == null || raw === '') return defecto
  const v = parseStrictInt(raw)
  if (v == null || v <= 0) {
    process.stderr.write(`${nombre} inválido: "${raw}" — debe ser un número de milisegundos mayor que 0.\n`)
    process.exit(2)
  }
  return v
}

// EL LOG LO ABRE EL PROPIO VIGILANTE, nunca quien lo lanza, y va fuera del repo
// (`~/.claude/control-tower/log/`, ver run-metrics.js#controlTowerLogDir). Dos
// motivos, los dos aprendidos a golpes: fuera del repo para que ningún `git add`
// de la slice lo meta en la PR, y lo abre él porque cuando lo abría `ct-next` la
// suite acabó creando ficheros en el `$HOME` real de quien la corriera —
// exactamente lo que `__tests__/fixtures/hermetic-env.js` existe para evitar— y
// además dejaba un descriptor sin cerrar por slice.
//
// QUE NO SE PUEDA ABRIR NO IMPIDE VIGILAR: perder el rastro es peor que no
// tenerlo, pero mucho menos malo que perder el aviso que se estaba esperando.
export function abrirLog(logPath) {
  let fd = null
  if (logPath) {
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      fd = openSync(logPath, 'a')
    } catch (e) {
      process.stderr.write(`aviso: no se pudo abrir el log ${logPath} (${e.message}) — se vigila igual, sin rastro en disco\n`)
    }
  }
  const log = (msg) => {
    const linea = `${new Date().toISOString()} ${msg}\n`
    if (fd !== null) { try { writeSync(fd, linea) } catch { /* el rastro se pierde, la vigilancia no */ } }
    process.stdout.write(linea)
  }
  const terminar = (codigo) => {
    if (fd !== null) { try { closeSync(fd) } catch { /* ya está */ } }
    process.exit(codigo)
  }
  return { log, terminar }
}
