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
