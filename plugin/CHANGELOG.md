# Changelog

## [0.58.0](https://github.com/josemerca/control-tower-plugin/compare/plugin-v0.57.0...plugin-v0.58.0) (2026-09-08)


### Funcionalidades

* **conventions:** el borde sale de architecture.md y rige en todo diff ([8374143](https://github.com/josemerca/control-tower-plugin/commit/83741434b558ac749f21bee91ed3c5c6f4ec719d))
* **conventions:** la vara de ct mide el nombre, el port y el value object ([c54ef0e](https://github.com/josemerca/control-tower-plugin/commit/c54ef0e53e13aa51278f656e1740158dc5a02cab))
* **conventions:** la vara de ct mide lo que un diff no añade ([ac07988](https://github.com/josemerca/control-tower-plugin/commit/ac0798848fce307f52b03ba1dc4944a8e027af59))
* **conventions:** la vara de ct se hace agnóstica y hereda lo que el backend pagó ([1ec89b9](https://github.com/josemerca/control-tower-plugin/commit/1ec89b98a00e7109ef9b8752db5fcd779a7d577c))
* **conventions:** la vara mide cada capa y exige la barrida de mutación ([ac621bf](https://github.com/josemerca/control-tower-plugin/commit/ac621bfb750ee4589cd9600b541f983b29215450))
* **conventions:** las capas se ven en el árbol y un tipo nuevo se justifica ([13b6a1e](https://github.com/josemerca/control-tower-plugin/commit/13b6a1e3691dd62c69dd04438c7399dc1dbf0d76))
* el segundo veto escala a un consejero en vez de repetir el intento a ciegas ([3252e3a](https://github.com/josemerca/control-tower-plugin/commit/3252e3a8c69a815388b943b72481f4f413088de5))
* **kickoff:** el plan abre simplicity y decisions antes de prescribir ([d5999fa](https://github.com/josemerca/control-tower-plugin/commit/d5999fa6013fc38fc0dff509b6cf64485f5c3eda))
* **plugin:** el paso advise, declarado en los dos lados del contrato ([0b8ce48](https://github.com/josemerca/control-tower-plugin/commit/0b8ce4874c4b461419fafaf2308326b7f7316c38))
* **plugin:** el segundo veto escala a un consejero en vez de repetir el intento ([66bf437](https://github.com/josemerca/control-tower-plugin/commit/66bf437d190e97549c4474194530faed14881e40))
* **plugin:** el tercer intento arranca con el árbol limpio y con el consejo ([008ff69](https://github.com/josemerca/control-tower-plugin/commit/008ff6984dea3d755a8d40ca3fb81027eccf5d4d))
* **slice-judge:** la señal se juzga con la regla que nombra a su lector ([4f73279](https://github.com/josemerca/control-tower-plugin/commit/4f732791751700ede63a55c019c06a18f5ee00b3))


### Correcciones

* **convenciones:** el comando de la suite rapida vuelve a estar escrito, y la captura se declara ([8af7a75](https://github.com/josemerca/control-tower-plugin/commit/8af7a75275155000a022a05fbbd58f9f53088973))
* **conventions:** ata ALCANCES a FILES y cierra los tamaños y el alcance de --check-plan que quedaron sueltos ([e7475c0](https://github.com/josemerca/control-tower-plugin/commit/e7475c0d9912215e053272a1aade255c6c943424))
* **conventions:** domain.md nombra el servicio junto al ejecutable, y tres nombres de test dejan de mentir ([ce6f4c2](https://github.com/josemerca/control-tower-plugin/commit/ce6f4c29a6a5156a3236275529b279c2b915d78e))
* **conventions:** la proyeccion se valida estricta, y el borde se cita por su nombre ([1a4e5be](https://github.com/josemerca/control-tower-plugin/commit/1a4e5bee06e8bb6a6bf312016ddce8d2655580a4))
* **conventions:** la regla del nombre del contrato viaja al borde en vez de perderse ([52cebea](https://github.com/josemerca/control-tower-plugin/commit/52cebea46a5aeb0819be4ab28b1ba23e1764a408))
* **conventions:** la vara no presupone la forma del programa ni son cinco ([d7f4bc7](https://github.com/josemerca/control-tower-plugin/commit/d7f4bc711a06144c47f1c64c66b6cfeef1558d9d))
* **conventions:** plugin-yardstick.test.js enumera los siete documentos, no los cinco antiguos ([27a75dc](https://github.com/josemerca/control-tower-plugin/commit/27a75dcfe9b6e0a9c7e59bd81a96a397fe0122f7))
* **conventions:** quita el duplicado, usa boundary model y arregla dos nombres mas ([c758adc](https://github.com/josemerca/control-tower-plugin/commit/c758adc37620c4604fb0e4145ac0c27e4080cb71))
* **conventions:** repone el layout propio, da regla a la forma servicio y corrige las cifras ([5f9080b](https://github.com/josemerca/control-tower-plugin/commit/5f9080be3ed9fe605c73441132aba84e2809401a))
* **conventions:** restaura la guarda /skip/i y cambia la frase en simplicity.md ([0c22d05](https://github.com/josemerca/control-tower-plugin/commit/0c22d0554436e8b22ee463823e7f0af41ed9b582))
* **conventions:** testing.md deja de contradecirse y hace juzgable la barrida ([54b5ac8](https://github.com/josemerca/control-tower-plugin/commit/54b5ac86c12ed495206c77c9dfa27675c2e321f1))
* **conventions:** tres nombres de test en castellano sin acento ni palabra bloqueada ([6434d65](https://github.com/josemerca/control-tower-plugin/commit/6434d65c5530a08fee4328e73d9322033907e7f0))
* **conventions:** usa el vocabulario de arquitectura y testing en simplicity.md ([193348d](https://github.com/josemerca/control-tower-plugin/commit/193348de096fb6d2acbec5f1618643b2f5c992eb))
* **plugin:** el banco no le pide al juez el token que escribe el programa ([c5b3659](https://github.com/josemerca/control-tower-plugin/commit/c5b3659ae32f08f5aefffb2a9f89a52c6036d411))
* **plugin:** el banco reventaba con un veredicto correcto, y ahora hay línea base ([e2d844e](https://github.com/josemerca/control-tower-plugin/commit/e2d844e8f4ef8db1b9a228d2a5794c8500576782))
* **plugin:** los dos tests que fallaban por una carrera y por 1.900 procesos de git ([#118](https://github.com/josemerca/control-tower-plugin/issues/118)) ([4ffc0fe](https://github.com/josemerca/control-tower-plugin/commit/4ffc0fecea4d0e4dab27ecbdbfdce4ffd1f0689f))
* **skills:** la distinción de --check-plan cabe en el tope de la skill ([16b606f](https://github.com/josemerca/control-tower-plugin/commit/16b606fe349a41769f72a6ae443e7d23c954eb4f))
* **tests:** las cuatro correcciones del round de revision de tareas 7 y 8 ([3b67341](https://github.com/josemerca/control-tower-plugin/commit/3b67341effaa2081108ef2d0f35734cdd7a3ded0))
* **vara:** quita la contradicción de la barrida, la regla duplicada y la negativa sin ruta ([e4f8682](https://github.com/josemerca/control-tower-plugin/commit/e4f8682a57792608b596350370098cc07b990c2b))


### Refactorizaciones

* **plugin:** las reglas del juez dicen cuándo la tarea cumple, no qué buscar que falte ([#125](https://github.com/josemerca/control-tower-plugin/issues/125)) ([2162c45](https://github.com/josemerca/control-tower-plugin/commit/2162c45368fb6a4702b2ddcd531939a5d56d59da))


### Documentación

* **vara:** la forma del adaptador se declara en el test y nace de una captura real ([f6c5372](https://github.com/josemerca/control-tower-plugin/commit/f6c5372f81b4dabe0949353a79329db0d180d06c))

## [0.57.0](https://github.com/josemerca/control-tower-plugin/compare/plugin-v0.56.0...plugin-v0.57.0) (2026-09-07)


### Funcionalidades

* el baseline lo mide el programa, no lo afirma el agente ([1ad63b9](https://github.com/josemerca/control-tower-plugin/commit/1ad63b9edfb3c8099554be62899ff5462f25ecfa))
* la vara viaja por alcance, la precedencia se escribe una vez y el token lo pone el programa ([76a895f](https://github.com/josemerca/control-tower-plugin/commit/76a895fc0a1fd4039f66e36593dfd4613acb4982))
* **plugin:** aggregateRoleBytesMeasures lee los bytes por papel del slice ([f01ef15](https://github.com/josemerca/control-tower-plugin/commit/f01ef15779dfbddd955a43118a4d7fae6d3752db))
* **plugin:** baseline.js mide el comando de test del repo en el worktree ([580453f](https://github.com/josemerca/control-tower-plugin/commit/580453f88c4680d21077c0904e3254f8e59c6bb3))
* **plugin:** ct-next mide el baseline en el worktree recién cortado y lo siembra ([e47b2bf](https://github.com/josemerca/control-tower-plugin/commit/e47b2bf590581fe78e2f2a749a0b7072e761600e))
* **plugin:** el banco despacha al juez, valida su veredicto y lo compara con el esperado ([18e1bcc](https://github.com/josemerca/control-tower-plugin/commit/18e1bcc42a1b6fe7d863d9f6f6d3b773eeaeffdb))
* **plugin:** el brief lleva sólo los documentos de la vara que alcanzan a la tarea ([17c585f](https://github.com/josemerca/control-tower-plugin/commit/17c585faffa933d38bd5d89b41ab527e04b7e901))
* **plugin:** el hook de Stop deja de pedir lo que el programa ya sabe ([6497dbe](https://github.com/josemerca/control-tower-plugin/commit/6497dbef8ac30b0186e08a9b16ddf53527eb1566))
* **plugin:** el hook Stop actualiza last_commit cuando comiteó ct-step ([3870114](https://github.com/josemerca/control-tower-plugin/commit/3870114407c9be4a164b362f561782b68f93ffdd))
* **plugin:** el juez y el reconciliador reciben la vara de ct por ruta, no pegada ([c0cf05b](https://github.com/josemerca/control-tower-plugin/commit/c0cf05bda7893164b19b548e0ef5cff31ff0067e))
* **plugin:** el review_token del veredicto lo escribe el programa, no el juez ([c026bb9](https://github.com/josemerca/control-tower-plugin/commit/c026bb9dce666eee9d157f31742c07311587877b))
* **plugin:** judge-bench.mjs, el comando del banco con --dry-run ([c30b2a8](https://github.com/josemerca/control-tower-plugin/commit/c30b2a86cf6b3468b3bb07df5553cf5eb3dcb186))
* **plugin:** la cosecha proyecta los bytes por papel en tabla y esquema ([53685ad](https://github.com/josemerca/control-tower-plugin/commit/53685ada16e9329153a9eed745bbd093c51f6ff8))
* **plugin:** la fila de cada papel anota agent_bytes, skill_bytes y package_bytes ([6f5eefd](https://github.com/josemerca/control-tower-plugin/commit/6f5eefdc6430a521c270f1be745193021cda3d5d))
* **plugin:** la semilla lleva el campo baseline y el kickoff deja de ordenarlo ([6d3ccd0](https://github.com/josemerca/control-tower-plugin/commit/6d3ccd01d899d392ec051e4f825fa73967f59f38))
* **plugin:** la telemetría mide el material fijo de cada papel ([4e8fb6e](https://github.com/josemerca/control-tower-plugin/commit/4e8fb6e4257534e3c9562887306cc8a5544b2cf6))
* **plugin:** los paths de la tarea los mide el programa, no la declaración del implementador ([a42e967](https://github.com/josemerca/control-tower-plugin/commit/a42e96726d95cb2185417e197b46dc197ae77093))
* **plugin:** RoleBytes mide los bytes del material fijo de cada papel ([68a9508](https://github.com/josemerca/control-tower-plugin/commit/68a950892007420737b62a2e97d37fe726ed2f94))
* **plugin:** un banco de pruebas que mide si el juez acierta ([af3d5a8](https://github.com/josemerca/control-tower-plugin/commit/af3d5a83bb42aa88fa0071ad6682aecb0e7a9d0e))


### Correcciones

* **plugin:** el aviso no bloqueante del hook Stop deja de salir en cada turno ([82b2277](https://github.com/josemerca/control-tower-plugin/commit/82b227790f5a5fa066b829370c35980c9b928cc7))
* **plugin:** el lockfile vuelve a declarar la versión que declara el package.json ([5b4a337](https://github.com/josemerca/control-tower-plugin/commit/5b4a3379acc9bea65a0b34c6d3d75f056841e800))
* **plugin:** la hidratación deja de inyectar los comentarios del frontmatter ([90abba1](https://github.com/josemerca/control-tower-plugin/commit/90abba1aa1c8a55eed0fc3b1868ae09c2259f57b))
* **plugin:** los dos arreglos que sólo aparecen con esta rama y las otras cinco ([bdc811b](https://github.com/josemerca/control-tower-plugin/commit/bdc811b41338e7829900c9339b93601633405bbb))
* restore active workflows after restart ([6bc31b3](https://github.com/josemerca/control-tower-plugin/commit/6bc31b303b08a9917912bee0470a31d6eb7be83f))


### Refactorizaciones

* **backend:** errandFor importa la cabecera de la vara en vez de repetir la regla ([a2e8694](https://github.com/josemerca/control-tower-plugin/commit/a2e8694fb40469fd6dda22e7314f666aefdd9309))
* **plugin:** el contrato de slices sale de AGENTS.md a su fichero ([f1bdd30](https://github.com/josemerca/control-tower-plugin/commit/f1bdd3009b4af25071ab062d87434c5d4c1f1abb))
* **plugin:** el kickoff del slice deja de mandar leer los cinco documentos de la vara ([becc9c0](https://github.com/josemerca/control-tower-plugin/commit/becc9c091a4239a04f328d48dd57bec80d331484))
* **plugin:** fuera del paquete lo que ningun artefacto del loop lee ([2dcf6c0](https://github.com/josemerca/control-tower-plugin/commit/2dcf6c0165f63bb3da0065ea95473fe29121d5d2))
* **plugin:** la regla de precedencia se escribe en un solo sitio y los demás la citan ([f16e1da](https://github.com/josemerca/control-tower-plugin/commit/f16e1da6ff0449c9f56fd5617f5751ad181eb465))
* **plugin:** los comandos vuelven a ser instrucciones, no historia ([2be5420](https://github.com/josemerca/control-tower-plugin/commit/2be5420808b73872f5156b522133786726f194f1))


### Reversiones

* **plugin:** el fork de superpowers vuelve intacto al paquete ([869e17a](https://github.com/josemerca/control-tower-plugin/commit/869e17a3d55a47b087bc1358652cf70294c5c0c4))


### Documentación

* /ct-harvest documenta las tres columnas de bytes por papel ([bf3bb9b](https://github.com/josemerca/control-tower-plugin/commit/bf3bb9b577d0bf6615c4034c9c0de9f1063f0598))
* **plugin:** el README y el test de travesia siguen al contrato ([3ec8fc1](https://github.com/josemerca/control-tower-plugin/commit/3ec8fc134b9845fadb614e7dd56090e5488b39b6))
* **plugin:** la prosa de los comandos se muda a docs/loop/ ([07e34ef](https://github.com/josemerca/control-tower-plugin/commit/07e34ef8aeaefcbe145d087d5451c599c030c209))
