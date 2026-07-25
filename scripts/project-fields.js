// Lógica pura para elegir la iteración vigente de un campo Sprint (Project v2)
// entre las iteraciones devueltas por la introspección graphql
// (`ProjectV2IterationField.configuration.iterations`, cada una con
// `startDate` "YYYY-MM-DD" y `duration` en días). Extraída de ct-groom.mjs
// para poder testearla sin red: el cálculo de "hoy cae dentro de
// [startDate, startDate+duration)" es aritmética pura, no necesita `gh`.
//
// Se usan días-desde-época en UTC (no `Date#setDate` ni comparación de
// objetos Date con hora) para no depender de la zona horaria del proceso:
// una fecha "YYYY-MM-DD" sin hora se interpreta como medianoche UTC, y
// mutar esa fecha con setDate() opera en hora local, lo que puede
// desplazar el día calendario en husos horarios negativos.

const MS_PER_DAY = 86400000

function daysSinceEpochUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

// iterations: [{ id, title, startDate, duration }], todayIso: "YYYY-MM-DD" (o
// cualquier ISO string, se recorta a los primeros 10 caracteres).
// Devuelve la iteración vigente o null si ninguna cubre hoy.
export function pickCurrentIteration(iterations, todayIso) {
  const todayDay = daysSinceEpochUTC(todayIso.slice(0, 10))
  return (iterations || []).find((it) => {
    const start = daysSinceEpochUTC(it.startDate)
    return todayDay >= start && todayDay < start + it.duration
  }) || null
}
