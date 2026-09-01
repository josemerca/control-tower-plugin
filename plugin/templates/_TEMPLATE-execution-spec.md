# <Nombre del epic> — Execution spec

**Handoff origen:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
**Fecha de congelación:** —
**Estado:** DRAFT

## Hipótesis del experimento

**Apuesta:** <qué creemos que va a pasar si construimos esto, falsable y
medible — sin apuesta no hay epic y el groom rechaza el spec>.

**Cómo sabremos que falló:** <la condición observable que tumba la apuesta>.

**Anti-scope — qué NO hace este epic:** <lista explícita de lo que queda
fuera, para que ningún agente lo "regale">.

## Decisiones congeladas

<!-- Cada decisión lleva ID (D-1, D-2…) y su procedencia:
     - hablada: el usuario lo dijo — citar su frase literal cuando se pueda
     - deducida: se sigue de algo hablado — decir de qué
     - propuesta: idea del redactor — una propuesta NUNCA se congela: se
       pregunta al usuario o se aparca en «Decisiones aparcadas»

     Los huecos NO se rellenan a ojo: se marcan con el marcador de
     clarificación, que es la palabra NEEDS CLARIFICATION entre corchetes
     (corchete de apertura pegado a la N). Aquí no se escribe literal a
     propósito: `/ct-groom` lo busca por grep en TODO el fichero, comentarios
     incluidos y sin excepción (`analyzeSpecFreeze`, scripts/groom.js), así
     que un ejemplo literal en esta plantilla tumbaría con exit 2 el groom de
     cualquier spec que la copie sin borrar este bloque.

     Congelar con un marcador pendiente es inválido (exit 2). -->

- **D-1 · <Tema>** — <la decisión, en una o dos frases>. *(Procedencia:
  hablada — «<cita literal>».)*
- **D-2 · <Tema>** — <la decisión>. *(Procedencia: deducida de D-1.)*

## Enfoque técnico

<Párrafo(s) breves: el orden de construcción, qué módulo es el corazón, qué
áreas hay y por qué los slices se serializan o no. No es el plan — es el
racional que el plan de cada slice necesita y no puede deducir.>

<!-- INSTRUCCIONES DE «Contexto del epic» — a propósito FUERA de la sección.
     Todo lo que quede DENTRO de esa sección se copia, byte a byte, al cuerpo
     de todos los issues del epic: un comentario multilínea puesto ahí dentro
     NO se descarta, viaja verbatim a los N issues (verificado con
     `readEpicContext`). Por eso estas instrucciones viven aquí arriba.

     Reglas duras del groom para el contenido de esa sección:
     - solo bullets, negritas y vallas de código BIEN CERRADAS
     - nada de cabeceras ### o inferiores dentro (truncan la sección)
     - nada de comentarios HTML de una sola línea (truncan la sección)
     - ninguna valla ni comentario sin cerrar (se traga el resto del spec,
       la tabla de slices incluida)
     Contenido típico: stack, convenciones del repo, reglas de cálculo,
     invariantes que TODO slice debe respetar. -->

## Contexto del epic

- Stack: <lenguaje, frameworks, versiones>.
- <Invariante transversal 1>.
- <Invariante transversal 2>.

## Tabla de slices

<!-- Contrato de la tabla v18 (la valida /ct-groom, exit != 0 si falla):
     - Título del issue = "#N <Slice>": corto y legible, no una frase.
     - Tipo: ui | backend | infra | bugfix (decide el addendum del agente;
       ui implica gate visual, infra implica gate apply).
     - Dep: "#N" es el ORDEN del slice en esta tabla, no un número de issue.
     - Acepta: la coma separa criterios SIEMPRE; una coma literal dentro de
       un criterio se escapa como \,
     - Protegido: texto libre, lo que el slice NO puede tocar.
     - Área/Toca: tokens separados por coma; controlan colisión y
       serialización entre slices (migration, ci y pbxproj serializan).
     - Gate: solo para desviarse del default del Tipo — añadir (visual,
       apply) o renunciar (!visual). Vacío o – = sin declaración.
     - "Sin valor" = – (cualquier variante de guion) o celda vacía. -->

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |
|---|-------|------|---------|-----|--------|-----------|------|------|------|
| 1 | <nombre corto> | backend | <qué entrega, una frase> | – | <criterio 1>, <criterio 2> | <qué no toca> | <área> | – | – |
| 2 | <nombre corto> | backend | <qué entrega> | #1 | <criterios> | – | <área> | – | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|

*(Vacía al congelar es válido. Aquí van las «propuesta» sin resolver y el
futuro descartado explícitamente, por si se retoma.)*

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
