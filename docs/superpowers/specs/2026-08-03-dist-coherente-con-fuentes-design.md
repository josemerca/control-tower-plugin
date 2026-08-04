# El `dist/` commiteado tiene que corresponder a los fuentes commiteados

> F24 · 2026-08-03 · sale de la ejecución de F22 y se confirmó cinco veces durante F23.
> No estaba en ningún plan: es el único guard del repo que hoy depende de que alguien se acuerde.

## 1. El hueco

`hooks/hooks.json` ejecuta `dist/`, no `hooks/`:

```json
"command": "node ${CLAUDE_PLUGIN_ROOT}/dist/session-start.js"
```

`dist/` **está trackeado en git** (no aparece en `.gitignore`), así que el bundle commiteado es el artefacto que se ejecuta de verdad en cada repo donde el plugin está instalado.

Y `npm test` es:

```json
"test": "npm run build && vitest run"
```

El build corre **antes** que vitest. Consecuencia: la suite siempre mira un `dist/` recién construido, y **queda verde con un `dist` commiteado obsoleto**. Alguien que edite `hooks/session-start.js`, commitee el fuente y olvide `git add dist/` tiene suite verde, `main` verde, y unos hooks que ejecutan código viejo.

Ya pasó una vez, en F22. Durante F23 se comprobó a mano cinco veces por disciplina; nada lo comprueba solo.

### 1.1 Lo que sí está cubierto, y por qué no basta

| Test | Qué comprueba | Por qué no cierra el hueco |
|---|---|---|
| `__tests__/bundle.test.js` | que los bundles existen y sólo importan builtins `node:` | lo hace sobre el `dist/` **recién construido**, no sobre el commiteado |
| `__tests__/hooks-json.test.js` | que `hooks.json` apunta a ficheros que existen | un fichero obsoleto también existe |

Ninguno pregunta si el bundle **corresponde a los fuentes**.

### 1.2 No hay CI

`.github/` no existe. La suite local es el único sitio que se ejecuta de verdad, así que ahí va el test. Si algún día hay CI, este mismo test sirve sin cambios: no depende del árbol de trabajo.

## 2. Diseño

### 2.1 La propiedad, y por qué el árbol de trabajo no aparece

Una sola: **el `dist/` de HEAD es exactamente lo que produce construir los fuentes de HEAD.**

El árbol de trabajo no se lee en ningún punto, ni se usa para decidir si saltar. De ahí salen las dos conductas que hacen el test usable:

- **verde mientras editas sin commitear** — HEAD sigue siendo coherente consigo mismo, así que el test no interfiere con ningún ciclo rojo-verde;
- **rojo en cuanto existe un commit con el bundle obsoleto** — que es el estado que el defecto produce.

La alternativa barata —comparar el `dist/` del árbol contra el de HEAD, saltando si hay fuentes sucios— se descartó: se salta justo cuando hay trabajo sin commitear, y «se salta» es cómo el bug de F22 sobrevivió la primera vez.

### 2.2 Mecánica

1. `git archive HEAD` a un directorio temporal. **Todo lo trackeado**, sin lista de rutas: una lista es algo que mantener y que se queda atrás.
2. Symlink de `node_modules` dentro del temporal (no está trackeado, y `esbuild` tiene que resolver).
3. Importar la configuración de build **desde el `build.mjs` del temporal** — el de HEAD, no el del árbol — y correr `esbuild` con `absWorkingDir` apuntando al temporal y `metafile: true`.
4. Comparar el `dist/` resultante con el de HEAD, leído con `git show HEAD:<ruta>`.

Que la configuración se **importe** en vez de duplicarse es lo que hace que un cambio en `build.mjs` sin reconstruir también salga rojo: si el test llevara su propia copia del `entryPoints`/`banner`/`format`, esa copia se quedaría atrás en silencio y el test daría verde sobre una configuración que ya no es la del proyecto. Y una sola invocación de esbuild da a la vez los bytes de salida y la lista de inputs que necesita el diagnóstico del §2.4.

Esto exige un cambio mínimo en `scripts/build.mjs`: exportar el objeto de opciones en vez de tenerlo inline, conservando su conducta de CLI (`npm run build` sigue construyendo al ejecutarlo). Es la única modificación de producción de F24, y su porqué —tener una sola fuente de verdad para la configuración de build— hay que dejarlo escrito en el propio fichero.

### 2.3 Cobertura por propiedad, no por lista

`bundle.test.js` itera sobre `['dist/session-start.js', 'dist/stop.js']`, una lista literal. Este test **no**: compara el directorio entero en las **dos direcciones** — mismo conjunto de ficheros, y mismo contenido byte a byte para cada uno.

Si mañana aparece un tercer hook, queda cubierto sin que nadie se acuerde de añadirlo. Y si el build deja de emitir uno, también sale. Es la lección que la ronda de F23 cobró tres veces: auditar por propiedad, nunca por lista.

### 2.4 Diagnóstico exacto, no heurístico

Un fallo tiene dos causas posibles y el arreglo es el mismo, pero saber cuál es cambia lo que el lector piensa que ha hecho mal. Se distinguen sin adivinar:

La build del temporal corre con `metafile: true`, que devuelve la lista **real** de ficheros que entran a cada bundle. Con esa lista se diffean **sólo esos inputs** entre el último commit que tocó `dist/` (`git log -1 --format=%H -- dist/`) y HEAD:

- **alguno cambió** → falta un rebuild. Se nombran los ficheros.
- **ninguno cambió** → se movió el toolchain. Se nombra la versión de `esbuild` instalada.

El diffeo tiene que ser sobre los inputs reales y no sobre `scripts/` entero: los hooks sólo importan `scripts/state.js` y `scripts/state-paths.js`, así que un cambio en cualquier otro fichero de `scripts/` no entra al bundle. F23 tocó cinco ficheros de `scripts/` y ninguno de ellos; por eso el último commit que tocó `dist/` sigue siendo de F22. Un diagnóstico que mirara `scripts/` entero habría dicho «cambiaron los fuentes» en falso.

### 2.5 La deriva de toolchain es un fallo real, no un falso positivo

`esbuild` está declarado como `^0.28.1`. Un `npm install` puede traer una versión que produzca bytes distintos sin que nadie toque un fuente, y el test se pondrá rojo.

Eso es correcto y deliberado: `dist/` es el artefacto que **se ejecuta** en los repos de los usuarios, no un derivado interno. Si el toolchain produce otra cosa, lo commiteado dejó de ser reproducible desde este árbol, y merece saberse. El arreglo es el mismo comando de siempre:

```
npm run build && git add dist/ && git commit
```

Se descartó fijar `esbuild` a versión exacta: cambia una dependencia del proyecto, que es más de lo que este test pide.

### 2.6 Cuando no puede responder, falla

Sin git, sin `node_modules`, o si el build del temporal revienta: **rojo, nombrando el motivo**. Nunca un skip silencioso.

Este test nace precisamente de que la suite se quedó verde sin haber comprobado; un skip lo devolvería al mismo sitio con otra cara. Es el mismo criterio que el repo ya aplica en `ct-groom.mjs` a los fallos de lectura de `gh`: no se degradan a «no hay nada», se abortan con mensaje.

## 3. Alcance

**Entra:**
- un fichero de test nuevo, `__tests__/dist-coherente-con-fuentes.test.js`;
- un cambio mínimo en `scripts/build.mjs`: exportar el objeto de opciones, conservando la conducta de CLI (§2.2). Sin él, el test tendría que duplicar la configuración de build y esa copia se quedaría atrás en silencio.

**No entra:**
- no se añade ningún artefacto trackeado (se descartó el manifiesto de hashes: un fichero más que mantener, y no detecta que el bundle en sí esté corrupto);
- no se cambia ninguna dependencia;
- no se toca `npm test` ni el orden build→vitest.

## 4. Tests del test

El test es una comprobación; lo que hay que demostrar es que **falla cuando debe**, no sólo que pase hoy.

- **Verde sobre el HEAD actual.** El estado real del repo es coherente, así que el test pasa sin tocar nada.
- **Rojo con un `dist` obsoleto.** Sobre un repo temporal fabricado: commit con fuente y bundle coherentes, luego un commit que cambia el fuente sin regenerar el bundle → el test detecta y nombra el fichero.
- **Rojo si falta un fichero en `dist/`,** y rojo si sobra uno — las dos direcciones de la comparación de conjunto.
- **Verde con el árbol de trabajo sucio.** Editar un fuente sin commitear no debe poner nada rojo: es la conducta que hace el test usable en un ciclo TDD, y sin este caso nadie sabría que se preservó.
- **El diagnóstico acierta.** Que el mensaje diga «falta rebuild» cuando cambió un input, y «se movió el toolchain» cuando no cambió ninguno.
- **Falla con motivo** cuando no puede responder.
- **`npm run build` sigue funcionando** tras el refactor de `build.mjs` — que exportar las opciones no haya roto la conducta de CLI se demuestra corriéndolo, no razonándolo.

## 5. Lo que este test retira

La comprobación manual `npm run build && git status --porcelain dist/`, que en F23 hubo que correr cinco veces a mano y que sólo funciona si quien la corre se acuerda. A partir de aquí, cualquier tarea que toque `hooks/` o los fuentes que entran al bundle queda cubierta por la suite.
