# El banco de pruebas del juez

El juez es el único punto del loop donde el modelo decide algo que el programa no puede
comprobar. Los tres primeros incidentes del catálogo son jueces que aprobaron trabajo
incorrecto, y hasta ahora la única forma de decir si un cambio en la rúbrica mejoraba algo era
leer veredictos a mano. Este banco convierte «el juez parece mejor» en una tasa de acierto y un
coste.

**No forma parte de `npm test`.** Lo que sí entra en la suite es el runner —con el ejecutor de
`claude` doblado— y la coherencia de los casos. Contra el modelo se ejecuta a mano, antes y
después de tocar un agente.

## Ejecutarlo

```bash
node plugin/scripts/judge-bench.mjs --agent plugin/agents/ct-judge.md --runs 5
```

| Flag | Qué hace |
|---|---|
| `--agent <ruta>` | El fichero del agente a medir. De su frontmatter salen el modelo y las herramientas, y de su cuerpo el prompt: el banco nunca hereda el modelo de quien lo lanza. Obligatorio |
| `--runs N` | Cuántas veces se juzga cada caso. Por defecto 5 |
| `--case <nombre>` | Un solo caso, por el nombre de su directorio |
| `--dry-run` | Prepara los directorios e imprime los comandos `claude` que lanzaría, sin lanzar ninguno |
| `--budget-usd <n>` | Tope de gasto por run (`--max-budget-usd`). Por defecto 3 |
| `--cases <dir>` | Otro directorio de casos. Por defecto `plugin/__tests__/fixtures/judge-bench/` |

Códigos de salida: `0` todos los runs aciertan, `1` alguno no, `2` uso, `3` precondición (el
agente no se puede leer, un caso está corrupto, `claude` no está en el PATH).

La salida es una tabla con una fila por caso y una de total: runs, tasa de acierto, tasa de
descarte por esquema, runs que no llegaron a ejecutarse, la distribución de severidades de los
hallazgos y el coste sumado de `total_cost_usd`. Debajo, un renglón por cada run que no acertó
con el motivo y el directorio donde quedaron su brief, su paquete y su veredicto.

Un run cae en una de cuatro clases, y la diferencia importa:

- **acierto** — el `ruling` es el esperado y hay un hallazgo bajo cada regla que el caso exige.
- **fallo** — el juez juzgó y se equivocó: otro `ruling`, o el `ruling` correcto por la regla
  equivocada. Lo segundo cuenta como fallo a propósito: la telemetría del loop cuenta hallazgos
  por regla, y un FAIL por `alcance` sobre un defecto de `asercion-tdd` no es el mismo juez.
- **descarte** — el veredicto no pasa `VERDICT_SCHEMA` (el mismo `readVerdict` que aplica
  `ct-step verdict`, no una copia), o no copia el `Review token:` del paquete. En un run de
  verdad esto cuesta una vuelta pagada; aquí es una columna.
- **no ejecutado** — `claude` no llegó a contestar (autenticación, cuota, tope de gasto). No es
  un dato sobre el juez y no se mezcla con los otros tres.

## Comparar dos versiones del agente

El banco mide un fichero de agente, no el instalado, así que dos versiones se comparan
apuntándolo a cada una:

```bash
git show HEAD:plugin/agents/ct-judge.md > /tmp/ct-judge-antes.md
node plugin/scripts/judge-bench.mjs --agent /tmp/ct-judge-antes.md   --runs 5 | tee /tmp/antes.txt
node plugin/scripts/judge-bench.mjs --agent plugin/agents/ct-judge.md --runs 5 | tee /tmp/despues.txt
```

Qué se compara, y en este orden:

1. **La tasa de acierto por caso.** Es la respuesta a la pregunta. Con `--runs 5` la resolución
   es de 20 puntos: 4/5 y 5/5 no son distinguibles con esa N, así que una mejora de un solo run
   no es una mejora.
2. **La tasa de descarte.** Una rúbrica más larga que sube el acierto y triplica los descartes
   sale más cara de lo que parece: cada descarte es una vuelta pagada, y seis matan el run.
3. **La distribución de severidades sobre el caso correcto.** Los `medium` de una tarea correcta
   son vetos defensivos: cada uno manda al implementador a una vuelta pagada sin defecto que
   arreglar. Que bajen es una mejora aunque el acierto no se mueva.
4. **El coste.** El juez corre con opus una vez por tarea y por reintento; un preámbulo más
   largo se paga en cada una.

Guarda las dos salidas junto al cambio del agente. Una tasa sin la corrida que la produjo es una
opinión.

## Añadir un caso

Un caso es un directorio bajo `plugin/__tests__/fixtures/judge-bench/<nombre>/` con cuatro
piezas:

| Pieza | Qué es |
|---|---|
| `brief.md` | El brief de la tarea tal y como lo compone `task-brief --with-plan-context`: `### Desired end state`, `### Out of scope`, `## 2. Closed decisions`, `## 3. Reference patterns` y la tarea con sus marcadores `**Objective:**`, `**Files:**`, `**TDD:**`, `**Tests:**` y `**Verification:**`. La vara de ct **no** se escribe aquí: el banco la pega al final, leída del directorio `conventions/` del plugin, igual que hace `ct-step` |
| `package.md` | El paquete de revisión que escribe `escribirPaquete`: la cabecera `# Review package: task N/M of issue #I (staged, not yet committed)`, la línea `Review token: <sha256 del diff>`, y las secciones `## Files changed`, `## Rutas tocadas` y `## Diff` |
| `expected.json` | `{"ruling": "PASS"\|"FAIL", "must_find": ["<regla>"...], "incident": "…"}`. `must_find` sólo admite reglas de `VERDICT_RULES`; `incident` explica qué defecto de juicio mide el caso y es para quien lo lea, no para el programa |
| `repo/` | El árbol de trabajo que el juez va a poder abrir: el estado en el que el implementador lo dejó, con los ficheros que el paquete declara tocados ya aplicados. El juez lee el diff pero también abre ficheros, y un caso sin árbol lo deja midiendo sobre la mitad |

La forma de construirlo sin escribir un diff a mano: monta un repo temporal con el estado
previo, comitéalo, aplica los cambios del caso, `git add -A`, y saca de ahí `git diff --cached
--stat` y `git diff --cached -U10`. El token es `reviewToken(diff)` de
`plugin/scripts/step-contracts.js` — y el banco lo recomprueba al cargar el caso: un
`package.md` cuyo token no sea el sha256 de su propia sección `## Diff` es un caso corrupto y
aborta con exit 3, porque el juez descartaría ese veredicto por una razón que no es la que el
caso quería medir.

**Un caso mide un defecto de juicio, no un defecto de código.** Antes de escribirlo, contesta:
¿qué comprobación mecánica del loop deja pasar esto? Si un control lo pilla, no es asunto del
juez. Los tres iniciales pasan esa prueba: el `it.todo` deja `node --test` en verde y el grep de
`ct-step controls` encuentra el nombre del test; la carrera del claim pasa el test secuencial
que el propio diff trae; y la tarea correcta no tiene nada que pillar.

Después de crear el directorio, añade al caso su comprobación en
`plugin/__tests__/judge-bench.test.js` —el bloque `the bench cases on disk`— para que la pieza
que el caso mide esté atada por un test y no por el recuerdo de quien lo escribió.
