# Convergencia de los tres loops — propuesta

**Fecha:** 2026-08-14 · **Estado:** APROBADA en su decisión de fondo — D-1 resuelta el 2026-08-14
(**sí**, este repo acepta contribuciones externas). Las rondas siguen sin ejecutar.
**Inventario de capacidades:** [`tres-loops-un-pipeline.html`](./tres-loops-un-pipeline.html)
(publicado en <https://claude.ai/code/artifact/c3dda928-cbdb-4409-8bbd-6b1a86480ef3>)

Hay tres implementaciones del mismo ciclo, construidas por separado, y una de ellas ya se
distribuye bajo el nombre y la versión de otra. Este documento propone qué hacemos con eso.

| | |
|---|---|
| **CT** | `josemerca/control-tower-plugin` — plugin de Claude Code (JS), público, v0.34.0 |
| **JJ** | `jjponz/control-tower-plugin` — fork de CT + gate `plan` y contrato del plan |
| **AS** | `alcaptar/agentic-skills` — programa Python (`slice-runner`) + 2 skills, privado |

---

## 1. La tesis

**Hay dos convergencias distintas, y confundirlas es el error a evitar.**

- **Con JJ es convergencia de CÓDIGO.** Es un fork de CT: su trabajo se mergea. Un PR y ya.
- **Con AS es convergencia de MECANISMOS.** Es un programa de Python; no se puede fusionar
  dentro de un plugin de JavaScript, y forzarlo sería reescribir uno de los dos. Lo que se
  adopta son sus ideas, reimplementadas en el mundo de CT y **con atribución**; y lo que se
  acuerda es la **frontera**: dónde acaba una herramienta y empieza la otra.

**CT es el punto de convergencia de los dos tercios de delante** (de la idea al slice, y del
slice al plan) porque es el único de los tres que es público, instalable como plugin y ya base
de otro. **AS se mantiene como herramienta separada** para el tercio de detrás, con una frontera
escrita.

---

## 2. El reparto

| Tercio | Dueño | Qué cubre |
|---|---|---|
| **Delante** — de la idea al slice | **CT** | Congelación con procedencia, tabla de slices, dependencias, colisión por área, puertas humanas del epic |
| **Medio** — del slice al plan | **CT**, con la pieza de JJ | El plan como artefacto comprobable: literalidad, taxonomía de bloques, validación y gate duro |
| **Detrás** — del plan al despliegue | **AS** | Conducción como programa, juez independiente, presupuesto en dinero, vigilancia post-merge |

CT **adopta selectivamente** del tercio de detrás lo que puede vivir en un plugin (el juez
independiente, el presupuesto). Lo que depende de la observabilidad de Mercadona —`deploy-watch`
y el análisis de causa raíz— **se queda en AS** y se encadena, no se copia.

---

## 3. El plan, por rondas

### Ronda 0 — desactivar la colisión (esta semana, no es una ronda de producto)

No entrega funcionalidad: quita un problema que crece solo mientras no se toque.

- El fork cambia `name`, `owner` y `version` en `plugin.json` y `marketplace.json`.
- El fork arregla su `dist/` desincronizado (1 test en rojo hoy en su rama por defecto).
- **Dueño:** Juanjo. **Coste:** minutos.
- **Criterio de cierre:** los dos plugins se instalan a la vez en una máquina sin pisarse, y
  `ct-init` deja de declarar desactualizado al plugin original.

### Ronda F35 — el contrato del plan entra en Control Tower

- **Entra:** gate `plan` (**opt-in**), `plan-contract.js`, `--check-plan`, gate duro en
  `--release` (exit 6) y la skill `writing-plans-prescriptive`.
- **Cambio pedido antes de mergear:** el techo de tamaño se aplica **por tarea**, no al plan
  entero. Hoy el agente no puede partir un issue congelado, así que para caber junta todas las
  tareas en un commit: medido, de 8 tareas en un plan a 1 en los dos siguientes.
- **Fuera de esta ronda:** el `plan` siempre-on (espera a F36) y el cambio de tier de modelo de
  `subagent-driven-development` (decisión propia, commit propio).
- **Dueño:** Juanjo abre el PR; José revisa y mergea.
- **Criterio de cierre:** los planes de `repo-pulse` #3 y #4 revalidan con el techo nuevo y
  producen **dos o más tareas** cada uno.

### Ronda F36 — cerrar una puerta sin ir a la terminal

Es la ronda que desbloquea a todas las demás: **hoy cerrar un gate no despierta al agente**.
Responder en GitHub no le llega; hay que ir a su ventana de cmux y empujarlo con dos comandos.

- **Se adopta de AS:** la puerta se cierra respondiendo en el issue; token de aprobación por
  **coincidencia exacta** (con texto detrás no arranca) y gana la última respuesta; **dos relojes**
  distintos para esperar —a una máquina y a una persona— y **cada paso estrena su cuenta**.
- **Decisión de diseño abierta**, porque en CT el agente es una sesión viva y no un programa que
  consulta:
  - **(a)** que el propio agente consulte el issue antes de continuar — barato, pero depende de
    que obedezca, y en este repo un prompt no es un gate;
  - **(b)** un proceso que vigila el issue y empuja al agente por cmux — es lo que hoy se hace a
    mano. **Recomendada**: convierte un prompt en un mecanismo.
- **Criterio de cierre:** cerrar un gate respondiendo en GitHub, sin tocar la terminal,
  demostrado en `repo-pulse`.
- **Al cerrar esta ronda** se enciende el `plan` siempre-on que F35 dejó opt-in.

### Ronda F37 — el juez independiente

- **Se adopta de AS:** el que escribe no es el que juzga; **el juez no puede ejecutar nada**
  (sin `Bash`, así que no puede convencerse a sí mismo de que está verde); los controles
  mecánicos corren **antes** del juez y **el juez no ve su salida** (un lint sucio no gasta un
  intento adversarial ni le ensucia el criterio).
- Reimplementado en el mundo de CT: un subagente con conjunto de herramientas restringido.
- **Criterio de cierre:** el PR de un slice trae un veredicto emitido por un agente que no
  ejecutó nada.

### Ronda F38 — la medida

- **Se adopta de AS:** presupuesto **en dinero** por slice con corte duro, y gasto desglosado
  por papel (entender / implementar / juzgar). Se junta con `/ct-harvest`, que hoy mide el
  historial de GitHub y no el gasto.
- **Decisión aparte, no ronda:** el banco de pruebas de prompts. Es un proyecto en sí mismo y es
  lo único que permite contestar con datos si un cambio en cómo le hablamos al modelo mejora
  algo — empezando por el número del techo del plan.

---

## 4. La frontera con agentic-skills

Lo que **CT no absorbe**, y el acuerdo que lo sustituye:

- **`deploy-watch` y la vigilancia post-merge se quedan en AS.** Dependen de la observabilidad
  de Mercadona (Prometheus, Elasticsearch, logs de Google Cloud, Sentry). CT **para en el
  merge**; quien quiera la fase de después encadena `deploy-watch` a mano. Es un acuerdo de
  frontera, no de código.
- **El orquestador como programa se aplaza, no se descarta.** Alejandro llegó por el camino que
  CT lleva hoy —una skill orquestando dentro de tu sesión— y decidió reemplazarla por un
  programa. Es la pregunta arquitectónica de fondo y **no se aborda en estas cuatro rondas**:
  se revisa cuando estén cerradas, con los datos de F38 encima.

---

## 5. Decisiones que necesitan dueño

| # | Decisión | Dueño | Cuándo |
|---|---|---|---|
| ~~D-1~~ | ~~¿Control Tower acepta contribuciones externas, con PR y revisión?~~ — **RESUELTA 2026-08-14: sí.** Con ella quedan desbloqueadas la Ronda 0 y F35, y aparece D-6 | José | ✔ |
| D-2 | El techo del plan por tarea: qué número exacto | José + Juanjo | En F35, con el dato de cuántas vueltas de `--check-plan` costó |
| D-3 | Cómo se cierra un gate: que consulte el agente, o un proceso que lo vigile | José | En F36 |
| D-4 | ¿El orquestador de CT deja de ser una sesión de chat? | José | Aplazada — se revisa al cerrar F38 |
| D-5 | ¿`agentic-skills` se abre al equipo o sigue siendo personal? | Alejandro | Cuando quiera |
| D-6 | **Nace de D-1:** este repo no tiene CI (no existe `.github/workflows/`). Aceptar PRs externos sin nada que corra la suite deja la verificación en manos de quien revisa. ¿Se monta CI antes del primer PR externo? | José | **Antes de F35** |

---

## 6. Fuera de alcance

Escrito a propósito, con la misma regla que un execution spec: lo que no se va a hacer, dicho
antes de que alguien lo proponga a mitad.

- **No se fusiona `agentic-skills` dentro de Control Tower**, ni al revés.
- **No se reescribe Control Tower en Python.**
- **No se sube el número de agentes en paralelo** antes de que el ciclo se haya ganado la
  confianza. Es el aviso que cita el propio mapa de madurez de AS: *escalar el número de agentes
  antes de que el loop se haya ganado la confianza* es la trampa clásica.
- **No se toca el brainstorming ni la congelación.** Es lo único de los tres tercios que no está
  en discusión, y es la pieza que impide que un agente cuele decisiones inventadas como si
  fueran tuyas.

---

## 7. Riesgos

- **La divergencia gana usuarios mientras se decide.** El fork ya se distribuye. Cada persona
  que lo instale antes de la Ronda 0 se lleva un plugin que dice ser Control Tower, sin
  `scope-gate` y con los hooks compilados desincronizados.
- **Cambiar un número inventado por otro número inventado.** El techo por tarea es mejor que el
  techo por plan, pero sin el banco de pruebas seguimos calibrando a ojo.
- **Absorber demasiado de AS y romper la premisa de CT.** Control Tower vale porque es un plugin
  ligero que se instala y ya. Cada mecanismo que se adopta lo engorda: la vara es si la pieza
  cabe en un plugin sin arrastrar un runtime detrás.
- **Que las cuatro rondas se queden sin dueño.** Ronda 0 y F35 dependen de Juanjo; F36–F38 no
  dependen de nadie más que de José. Si D-1 se responde que no, este plan entero se cae y hay
  que escribir el otro: el de la separación limpia.
