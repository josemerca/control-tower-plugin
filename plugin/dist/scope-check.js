#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// scripts/scope-check-cli.js
import { execFileSync } from "node:child_process";

// scripts/closing-keywords.js
var CLOSING_KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved"
];
var CLOSING_RE = new RegExp(
  String.raw`\b(${CLOSING_KEYWORDS.join("|")})\b\s{0,10}:?\s{0,10}(#\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+)`,
  "gi"
);
function findClosingKeywords(text) {
  const src = typeof text === "string" ? text : "";
  const out = [];
  for (const m of src.matchAll(CLOSING_RE)) out.push({ keyword: m[1], ref: m[2] });
  return out;
}

// scripts/scope.js
var SECTION_HEADING = /^##\s+Contexto del epic\s*$/i;
var ANY_HEADING = /^#{1,6}\s+/;
var SCOPE_LINE = /^\s*[-*]?\s*\**\s*Alcance\s*\**\s*:\s*(.*)$/i;
var LOOP_ARTIFACT_PATTERNS = [
  // El kickoff ORDENA escribir aquí el plan del slice y commitearlo.
  "docs/superpowers/plans/**",
  // El skill de brainstorming escribe aquí el design doc y el execution spec, y
  // el slice rellena el «Registro de cierre (evidencia)» del spec al entregar.
  //
  // LÍMITE QUE HAY QUE DECIR EN VOZ ALTA: esta exención deja al agente escribir
  // en el spec CONGELADO sin que el gate lo vea — y en el incidente del
  // despacho 1 el agente metió ahí parte de su autorización falsa. El gate no
  // puede cubrirlo: no juzga prosa, juzga ficheros. La inmutabilidad de las
  // secciones congeladas del spec es una comprobación DISTINTA y está sin
  // construir.
  "docs/superpowers/specs/**",
  // `ct-step verdict` escribe aquí el veredicto del juez cuando el ruling es
  // PASS, lo stagea y lo deja DENTRO del commit de la tarea, porque el
  // veredicto tiene que viajar en la pull request (criterio de cierre de F37:
  // «el PR de un slice trae un veredicto emitido por un agente que no ejecutó
  // nada»). El implementador no elige esa escritura y no puede evitarla, así
  // que sin esta exención el gate se pone rojo en CUALQUIER epic que declare su
  // línea `Alcance:` y pide algo imposible —«o el trabajo sale del PR, o el
  // alcance del epic cambia»—, que es el muro insatisfacible de F14 otra vez.
  "docs/superpowers/verdicts/**",
  // La telemetría del run: una fila por intento de cada paso de cada tarea. La
  // escribe el loop, no el implementador, y por el mismo motivo que el
  // veredicto va a dejar de vivir solo en el disco de quien la escribió para
  // viajar en la pull request. La exención se pone ANTES de que llegue esa
  // escritura a propósito: al revés, el primer slice que la produzca sale rojo
  // por un fichero del loop y quien lea el gate no podrá distinguir si el rojo
  // lo puso el agente o la maquinaria.
  "docs/superpowers/metrics/**",
  // `ct-step e2e` ESCRIBE aquí el informe de la travesía y lo stagea, así que
  // viaja en el commit de la slice. Directorio PROPIO y no el «Registro de
  // cierre» del spec a propósito: esa exención (specs/**, arriba) es el agujero
  // por el que, en el incidente del despacho 1, un agente metió parte de su
  // autorización falsa — y meter por ahí justo la evidencia de que algo se
  // verificó es la peor combinación posible. Aquí no escribe nadie más.
  "docs/superpowers/e2e/**"
];
function normalizePath(p) {
  return String(p || "").replace(/^\.\//, "").replace(/^\/+/, "");
}
function parseScope(issueBody2) {
  const texto = typeof issueBody2 === "string" ? issueBody2 : "";
  const lineas = texto.split(/\r?\n/);
  let dentro = false;
  const patterns = [];
  for (const linea of lineas) {
    if (SECTION_HEADING.test(linea)) {
      dentro = true;
      continue;
    }
    if (dentro && ANY_HEADING.test(linea)) break;
    if (!dentro) continue;
    const m = linea.match(SCOPE_LINE);
    if (!m) continue;
    const valor = m[1].replace(/^\*\*(?=\s)/, "");
    for (const trozo of valor.split(",")) {
      const limpio = trozo.replace(/`/g, "").trim();
      if (limpio) patterns.push(limpio);
    }
  }
  if (!patterns.length) {
    return {
      declared: false,
      patterns: [],
      reason: "el epic no declara `Alcance:` en su secci\xF3n `## Contexto del epic` \u2014 sin alcance declarado el gate no puede comprobar nada, y no poder comprobar NO es estar limpio"
    };
  }
  return { declared: true, patterns, reason: null };
}
function matchesPattern(path, pattern) {
  const p = normalizePath(path);
  let pat = normalizePath(pattern);
  if (!pat) return false;
  if (pat.endsWith("/")) pat = `${pat}**`;
  let re = "^";
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        if (pat[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re).test(p);
}
function scopeViolations(files, patterns, extraExempt = []) {
  const pats = Array.isArray(patterns) ? patterns.filter(Boolean) : [];
  const exentos = [...LOOP_ARTIFACT_PATTERNS, ...Array.isArray(extraExempt) ? extraExempt.filter(Boolean) : []];
  return (files || []).map(normalizePath).filter((f) => f).filter((f) => !exentos.some((pat) => matchesPattern(f, pat))).filter((f) => !pats.some((pat) => matchesPattern(f, pat)));
}
function isSliceBranch(name) {
  return /^feat\/\d+$/.test(String(name || "").trim());
}
function issueFromPrBody(prBody) {
  const encontrados = findClosingKeywords(typeof prBody === "string" ? prBody : "");
  const numeros = /* @__PURE__ */ new Set();
  for (const { ref } of encontrados) {
    const m = String(ref).match(/#(\d+)$/);
    if (m) numeros.add(Number(m[1]));
  }
  if (numeros.size !== 1) return null;
  return [...numeros][0];
}

// scripts/scope-check-cli.js
var arg = (f) => {
  const i = process.argv.indexOf(f);
  if (i === -1) return void 0;
  const v = process.argv[i + 1];
  return typeof v === "string" && !v.startsWith("--") ? v : true;
};
var usage = "uso: scope-check --repo <owner/repo> --pr <n\xFAmero> [--exempt <patr\xF3n,patr\xF3n>]";
var repo = arg("--repo");
var pr = arg("--pr");
var exemptRaw = arg("--exempt");
var exempt = typeof exemptRaw === "string" ? exemptRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
if (typeof repo !== "string" || typeof pr !== "string" || !/^\d+$/.test(pr)) {
  console.error(usage);
  process.exit(2);
}
var gh = (a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20 * 1024 * 1024, timeout: 5 * 60 * 1e3, killSignal: "SIGKILL" });
function morir(mensaje, detalle) {
  console.error(`\u{1F6D1} scope-check: ${mensaje}`);
  if (detalle) console.error(`   ${detalle}`);
  process.exit(1);
}
var prData;
try {
  prData = JSON.parse(gh(["pr", "view", pr, "--repo", repo, "--json", "body,files,headRefName"]));
} catch (e) {
  morir(`no se pudo leer el PR #${pr} de ${repo}`, (e.stderr || e.message || "").toString().trim());
}
var issueN = issueFromPrBody(prData.body);
if (!issueN) {
  if (isSliceBranch(prData.headRefName)) {
    morir(
      `el PR #${pr} viene de la rama de slice \`${prData.headRefName}\` pero no declara un \xFAnico issue con una closing keyword en su CUERPO`,
      "A\xF1ade `Closes #<issue>` al cuerpo del PR (no al t\xEDtulo, no en un comentario). Sin \xE9l, adem\xE1s, el issue no se cierra al mergear y el slice retiene sus tokens de `area:`/`touches:` para siempre."
    );
  }
  console.log(`\u2705 scope-check: el PR #${pr} no es un slice del loop (rama \`${prData.headRefName}\`, sin closing keyword). No hay alcance de epic que comprobar.`);
  process.exit(0);
}
var issueBody;
try {
  issueBody = JSON.parse(gh(["issue", "view", String(issueN), "--repo", repo, "--json", "body"])).body;
} catch (e) {
  morir(`no se pudo leer el issue #${issueN} de ${repo}`, (e.stderr || e.message || "").toString().trim());
}
var alcance = parseScope(issueBody);
if (!alcance.declared) {
  morir(
    `el epic del issue #${issueN} no declara alcance`,
    `${alcance.reason}. A\xF1ade una l\xEDnea \`Alcance: <rutas>\` a la secci\xF3n \`## Contexto del epic\` del execution spec y re-groomea (o edita el issue). Se declara UNA vez por epic, en la congelaci\xF3n.`
  );
}
var ficheros = (prData.files || []).map((f) => f.path);
var violaciones = scopeViolations(ficheros, alcance.patterns, exempt);
if (violaciones.length) {
  console.error(`\u{1F6D1} scope-check: el PR #${pr} toca ${violaciones.length} fichero(s) FUERA del alcance declarado por su epic (issue #${issueN}).`);
  console.error("");
  console.error("   Alcance declarado:");
  for (const p of alcance.patterns) console.error(`     \u2713 ${p}`);
  console.error("");
  console.error("   Fuera de alcance:");
  for (const f of violaciones) console.error(`     \u2717 ${f}`);
  console.error("");
  console.error("   Esto NO se arregla editando el registro del PR. O el trabajo sale del PR,");
  console.error("   o el alcance del epic cambia \u2014 y cambiar el alcance de un epic congelado es");
  console.error("   una decisi\xF3n humana, no del agente.");
  process.exit(1);
}
console.log(`\u2705 scope-check: los ${ficheros.length} fichero(s) del PR #${pr} caben en el alcance del epic (issue #${issueN}).`);
process.exit(0);
