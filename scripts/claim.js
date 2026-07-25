// Lógica pura del claim endurecido (labels GitHub como lock).
function tokensOf(labels) {
  return (labels || []).filter((l) => l.startsWith('area:') || l.startsWith('touches:'))
}

export function conflictTokens(candLabels, otherLabels) {
  const other = new Set(tokensOf(otherLabels))
  return tokensOf(candLabels).filter((t) => other.has(t))
}

export function detectCollisions(candLabels, openIssues) {
  const out = []
  for (const iss of openIssues) {
    if (!(iss.labels || []).includes('status:in-progress')) continue
    const tokens = conflictTokens(candLabels, iss.labels)
    if (tokens.length) out.push({ n: iss.n, tokens })
  }
  return out
}

export function claimLost(readback, self) {
  const mine = readback.find((i) => i.n === self)
  if (!mine) return false
  const myTokens = tokensOf(mine.labels)
  for (const iss of readback) {
    if (iss.n === self) continue
    if (!(iss.labels || []).includes('status:in-progress')) continue
    const shared = tokensOf(iss.labels).some((t) => myTokens.includes(t))
    if (shared && iss.n < self) return true // desempate determinista: gana el menor número
  }
  return false
}
