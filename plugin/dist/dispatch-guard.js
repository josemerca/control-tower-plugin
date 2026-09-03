#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// hooks/dispatch-guard.js
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// scripts/reconcile-outcome.js
var ReconcileOutcome = Object.freeze({
  UP_TO_DATE: "up-to-date",
  MERGED: "merged",
  CONFLICTING: "conflicting",
  UNMERGEABLE_TREE: "unmergeable-tree",
  RESOLVED: "resolved",
  ROUND_DISCARDED: "round-discarded",
  MARKERS_COMMITTED: "markers-committed"
});
var DiscardReason = Object.freeze({
  MARKERS_LEFT: "markers-left",
  TOUCHED_OUTSIDE_THE_CONFLICT: "touched-outside-the-conflict",
  UNRESOLVED_FILES_REMAIN: "unresolved-files-remain"
});

// scripts/run-machine.js
var STEPS = Object.freeze({
  IMPLEMENT: "implement",
  CONTROLS: "controls",
  JUDGE: "judge",
  COMMIT: "commit",
  // RECONCILE va ANTES de GLOBAL y no después: la punta a punta del plan
  // (`global`) tiene que correr sobre el árbol ya puesto al día con su base,
  // no sobre uno que se quede atrás y que luego el merge de la pull request
  // vuelva a mover. Verificar antes de reconciliar mediría un árbol que ya no
  // es el que se entrega.
  RECONCILE: "reconcile",
  // GLOBAL / SLICE_JUDGE (§3.7) y E2E son los tres pasos que NO son por tarea:
  // se entra en ellos al comitear la última, y cierran la SLICE, no una tarea.
  GLOBAL: "global",
  SLICE_JUDGE: "slice-judge",
  // E2E — el último de esa cola, y el único condicional: sólo se entra si la
  // slice declara recorridos. Va aquí y no colgado de `controls` porque
  // `controls` mide lo que el PLAN prometió contra el árbol, por tarea, y esto
  // atraviesa lo que el SPEC declaró contra el sistema levantado, por slice.
  // Colgarlo de controls obligaría a que cada tarea arrastrara un e2e que no le
  // toca, o a un controls especial en la última — una rama de la tabla que no
  // describe ningún estado real.
  E2E: "e2e"
});
var OUTCOMES = Object.freeze({
  DONE: "done",
  FAILED: "failed",
  INDETERMINATE: "indeterminate",
  CORRECTIONS_ORDERED: "corrections-ordered",
  DISCARDED: "discarded",
  OVER_BUDGET: "over-budget"
});
var RUN_STATES = Object.freeze({
  OPEN: "open",
  DELIVERED: "delivered",
  BLOCKED_CONTROLS: "blocked-controls",
  BLOCKED_JUDGE: "blocked-judge",
  BLOCKED_COMMIT: "blocked-commit",
  BLOCKED_GLOBAL: "blocked-global",
  BLOCKED_SLICE_JUDGE: "blocked-slice-judge",
  BLOCKED_RECONCILE: "blocked-reconcile",
  // Mismo sitio y misma forma que sus hermanos: un cierre en fallo del que
  // sale una persona, no un reintento.
  BLOCKED_E2E: "blocked-e2e",
  ABORTED_BUDGET: "aborted-budget"
});
var DEFAULT_BUDGETS = Object.freeze({
  controlRetries: 2,
  judgeRetries: 2,
  correctionRetries: 2,
  reconcileRetries: 2
});

// scripts/dispatch-gate.js
var Dispatch = Object.freeze({
  LET_THROUGH: "let-through",
  DENIED: "denied"
});
var DispatchVerdict = class _DispatchVerdict {
  static letThrough() {
    return new _DispatchVerdict(Dispatch.LET_THROUGH, null);
  }
  static denied(reason) {
    return new _DispatchVerdict(Dispatch.DENIED, reason);
  }
  constructor(dispatch, reason) {
    this.dispatch = dispatch;
    this.reason = reason;
    Object.freeze(this);
  }
};
var StepSeal = class _StepSeal {
  static #INPUT_OF = Object.freeze({
    [STEPS.IMPLEMENT]: "el brief de la tarea",
    [STEPS.JUDGE]: "el paquete de revisi\xF3n de la tarea",
    [STEPS.SLICE_JUDGE]: "el paquete de revisi\xF3n del slice"
  });
  static SEALED_STEPS = Object.freeze(Object.keys(_StepSeal.#INPUT_OF));
  static of(run) {
    return `${run.task}:${run.step}:${_StepSeal.#attempt(run)}`;
  }
  static inputWrittenFor(step) {
    return _StepSeal.#INPUT_OF[step] ?? null;
  }
  static #attempt(run) {
    return run.controlRetries + run.judgeRetries + run.correctionRetries + 1;
  }
};
var DispatchGate = class _DispatchGate {
  static verdictFor(run, ctStepPath) {
    if (run.closed) return DispatchVerdict.letThrough();
    const input = StepSeal.inputWrittenFor(run.step);
    if (input === null) return DispatchVerdict.letThrough();
    if (run.nextSeal === StepSeal.of(run)) return DispatchVerdict.letThrough();
    return DispatchVerdict.denied(_DispatchGate.#reason(run, ctStepPath, input));
  }
  static #reason(run, ctStepPath, input) {
    return [
      `El run del issue ${run.issue} est\xE1 en el paso "${run.step}" y todav\xEDa no has pedido el paso.`,
      "",
      `"ct-step next" no s\xF3lo dice cu\xE1l es el paso: ESCRIBE ${input}, que es el fichero que este subagente tiene que leer. Despachado ahora se queda sin \xE9l, y eso no se ve hasta que vuelve con el trabajo hecho encima de otra cosa.`,
      "",
      "Pide el paso y despacha con lo que imprima:",
      `  node ${ctStepPath} next --plan ${run.plan} --issue ${run.issue}`,
      "",
      '"next" no transiciona el run: informa y prepara, as\xED que pedirlo no cuesta ning\xFAn intento ni ning\xFAn descarte.'
    ].join("\n");
  }
};

// hooks/dispatch-guard.js
var RunFile = class _RunFile {
  static #DIR = ".agent";
  static #SHAPE = /^run-\d+\.json$/;
  static onlyOneIn(cwd) {
    const found = _RunFile.#listedIn(cwd);
    if (found.length !== 1) return null;
    return _RunFile.#parsed(found[0]);
  }
  static #listedIn(cwd) {
    if (typeof cwd !== "string" || cwd === "") return [];
    try {
      return readdirSync(join(cwd, _RunFile.#DIR)).filter((entry) => _RunFile.#SHAPE.test(entry)).map((entry) => join(cwd, _RunFile.#DIR, entry));
    } catch {
      return [];
    }
  }
  static #parsed(path) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }
};
var DispatchGuard = class _DispatchGuard {
  static #EVENT = "PreToolUse";
  static #TOOL = "Task";
  static decide(input, readRun, ctStepPath) {
    if (input?.hook_event_name !== _DispatchGuard.#EVENT) return null;
    if (input?.tool_name !== _DispatchGuard.#TOOL) return null;
    const run = readRun(input.cwd);
    if (run === null) return null;
    const verdict = DispatchGate.verdictFor(run, ctStepPath);
    if (verdict.dispatch === Dispatch.LET_THROUGH) return null;
    if (verdict.dispatch === Dispatch.DENIED) return _DispatchGuard.#payloadDenying(verdict.reason);
    throw new Error(`DispatchGuard cannot answer a verdict it does not know: ${JSON.stringify(verdict.dispatch)}`);
  }
  static #payloadDenying(reason) {
    return {
      hookSpecificOutput: {
        hookEventName: _DispatchGuard.#EVENT,
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
  }
  static ctStepBesideThisHook(hookUrl) {
    return join(dirname(dirname(fileURLToPath(hookUrl))), "scripts", "ct-step.mjs");
  }
};
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const decision = DispatchGuard.decide(input, RunFile.onlyOneIn, DispatchGuard.ctStepBesideThisHook(import.meta.url));
  if (decision) process.stdout.write(JSON.stringify(decision), () => process.exit(0));
  else process.exit(0);
}
export {
  DispatchGuard,
  RunFile
};
