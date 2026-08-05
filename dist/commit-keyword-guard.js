#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// hooks/commit-keyword-guard.js
import { readFileSync as readFileSync2, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// scripts/closing-keywords.js
function tokenizeSegments(command) {
  const src = typeof command === "string" ? command : "";
  const segments = [];
  let tokens = [];
  let cur = "";
  let has = false;
  const pushTok = () => {
    if (has) {
      tokens.push(cur);
      cur = "";
      has = false;
    }
  };
  const pushSeg = () => {
    pushTok();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      cur += src[i + 1] ?? "";
      has = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end === -1) {
        cur += src.slice(i + 1);
        has = true;
        break;
      }
      cur += src.slice(i + 1, end);
      has = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          cur += src[i + 1];
          i += 2;
          continue;
        }
        cur += src[i];
        i++;
      }
      has = true;
      i++;
      continue;
    }
    if (c === " " || c === "	") {
      pushTok();
      i++;
      continue;
    }
    if (c === "\n" || c === ";") {
      pushSeg();
      i++;
      continue;
    }
    if (c === "&" || c === "|") {
      pushSeg();
      i += src[i + 1] === c ? 2 : 1;
      continue;
    }
    cur += c;
    has = true;
    i++;
  }
  pushSeg();
  return segments;
}
var GIT_GLOBAL_TAKES_VALUE = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
var isGitBinary = (tok) => tok === "git" || tok.endsWith("/git");
var CLUSTER_CONSUMES_REST = /* @__PURE__ */ new Set(["F", "C", "c", "t", "S", "u"]);
function messagesFromSegment(tokens) {
  let i = 0;
  if (!tokens.length || !isGitBinary(tokens[0])) return [];
  i = 1;
  while (i < tokens.length && tokens[i].startsWith("-")) {
    const t = tokens[i];
    if (t.includes("=")) {
      i += 1;
      continue;
    }
    i += GIT_GLOBAL_TAKES_VALUE.has(t) ? 2 : 1;
  }
  if (tokens[i] !== "commit") return [];
  i += 1;
  const out = [];
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--") break;
    if (t === "--message") {
      if (i + 1 < tokens.length) out.push(tokens[++i]);
      continue;
    }
    if (t.startsWith("--message=")) {
      out.push(t.slice("--message=".length));
      continue;
    }
    if (t.startsWith("-") && !t.startsWith("--")) {
      const cluster = t.slice(1);
      let valor = null;
      for (let j = 0; j < cluster.length; j++) {
        const ch = cluster[j];
        if (ch === "m") {
          const pegado = cluster.slice(j + 1);
          valor = pegado.length > 0 ? pegado : i + 1 < tokens.length ? tokens[++i] : null;
          break;
        }
        if (CLUSTER_CONSUMES_REST.has(ch)) break;
      }
      if (valor !== null) out.push(valor);
      continue;
    }
  }
  return out;
}
function extractCommitMessages(command) {
  return tokenizeSegments(command).flatMap(messagesFromSegment);
}
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
  String.raw`\b(${CLOSING_KEYWORDS.join("|")})\b\s*:?\s*(#\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+)`,
  "gi"
);
function findClosingKeywords(text) {
  const src = typeof text === "string" ? text : "";
  const out = [];
  for (const m of src.matchAll(CLOSING_RE)) out.push({ keyword: m[1], ref: m[2] });
  return out;
}

// scripts/governed-repo.js
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
var CONTRACT_MARKER = "<!-- ct-init:slices-contract -->";
var AGENTS = "AGENTS.md";
function describirValor(v) {
  try {
    return String(v);
  } catch {
    return "<no se pudo describir>";
  }
}
function isRepoRoot(dir) {
  try {
    statSync(join(dir, ".git"));
    return true;
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return false;
    throw e;
  }
}
function probeGovernedRepo(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) {
    return { error: `cwd invalido: se esperaba una cadena no vacia y llego ${typeof cwd} (${describirValor(cwd)})` };
  }
  let dir;
  try {
    dir = resolve(cwd);
  } catch (e) {
    return { error: `cwd invalido: ${e.message}` };
  }
  try {
    statSync(dir);
  } catch (e) {
    return { error: `no se ha podido leer el directorio de trabajo (${e.code || e.message})` };
  }
  try {
    for (; ; ) {
      if (isRepoRoot(dir)) {
        let texto;
        try {
          texto = readFileSync(join(dir, AGENTS), "utf8");
        } catch (e) {
          if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return { governed: false };
          return { error: `no se ha podido leer ${AGENTS} (${e.code || e.message})` };
        }
        return { governed: texto.includes(CONTRACT_MARKER) };
      }
      const padre = dirname(dir);
      if (padre === dir) return { governed: false };
      dir = padre;
    }
  } catch (e) {
    return { error: `no se ha podido determinar la raiz del repo (${e.code || e.message})` };
  }
}

// hooks/commit-keyword-guard.js
function decidir(input, probe) {
  if (input?.hook_event_name !== "PreToolUse") return null;
  if (input?.tool_name !== "Bash") return null;
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || !command) return null;
  const mensajes = extractCommitMessages(command);
  if (!mensajes.length) return null;
  const hallazgos = mensajes.flatMap(findClosingKeywords);
  if (!hallazgos.length) return null;
  const sonda = probe(input.cwd);
  const salida = (permissionDecision, permissionDecisionReason) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason }
  });
  const citado = hallazgos.map((h) => `\`${h.keyword} ${h.ref}\``).join(", ");
  if (sonda.error) {
    return salida("ask", `Este mensaje de commit lleva ${citado}, y NO se ha podido comprobar si el loop Control Tower gobierna los issues de este repo: ${sonda.error}. Si los gobierna, ese commit cerrara ${hallazgos.length > 1 ? "esos issues" : "ese issue"} al llegar a la rama por defecto, sin que nadie revise ni mergee nada. Decide tu: reformula la frase para que no lleve la cadena literal, o continua si sabes que este repo no esta gobernado.`);
  }
  if (!sonda.governed) return null;
  return salida(
    "deny",
    `Este mensaje de commit lleva ${citado}. GitHub aplica las closing keywords de CUALQUIER mensaje de commit que llegue a la rama por defecto, y LAS COMILLAS NO PROTEGEN: un commit de documentacion que solo MENCIONABA la cadena cerro el issue en un repo real. En este repo el loop Control Tower gobierna los issues, asi que cerrarlo asi lo daria por entregado sin que nadie haya revisado ni mergeado nada, y liberaria sus dependencias sobre trabajo que puede no existir.

El cierre del slice va en el CUERPO DEL PR, no en el mensaje del commit.

Que hacer: reescribe la frase sin la cadena literal (por ejemplo \xABel kickoff no lleva la keyword de cierre\xBB en vez de nombrarla). Si de verdad quieres cerrar el issue, hazlo explicito: \`gh issue close <n> --reason completed\`.`
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input;
  try {
    input = JSON.parse(readFileSync2(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const resultado = decidir(input, probeGovernedRepo);
  if (resultado) process.stdout.write(JSON.stringify(resultado), () => process.exit(0));
  else process.exit(0);
}
export {
  decidir
};
