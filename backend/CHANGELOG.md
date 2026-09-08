# Changelog

## [0.3.0](https://github.com/josemerca/control-tower-plugin/compare/backend-v0.2.0...backend-v0.3.0) (2026-09-08)


### Funcionalidades

* ask an issue whether it stands exactly in review ([50a0ca0](https://github.com/josemerca/control-tower-plugin/commit/50a0ca003bb180685f3bcb8625c7b3ba4b29439e))
* **backend:** el comentario llega al issue en su propia sección, solo cuando lo hay (tarea 2/7, user_comment en /start-plan) ([18de709](https://github.com/josemerca/control-tower-plugin/commit/18de7096fda0500813f6b8634beb4bb3466d0278))
* **backend:** el encargo manda al agente leer lo que pidió a mano quien arrancó el plan (tarea 6/7, user_comment en /start-plan) ([057c400](https://github.com/josemerca/control-tower-plugin/commit/057c400f525fc720f52d5648b046bf52da069ab6))
* **backend:** el id de un plan sin historia es null, decidido una vez en PlanWatch.storyText() (tarea 4/7, user_comment en /start-plan) ([56a7de0](https://github.com/josemerca/control-tower-plugin/commit/56a7de0edb915d00a494769992f2af1030354c53))
* **backend:** el rechazo de repo/path nombra el campo desde la request, no desde la constante (tarea 2/4, repo_list en /start-plan) ([b86f7bd](https://github.com/josemerca/control-tower-plugin/commit/b86f7bde1fab6e5a6e2a5809d24910a410c93113))
* **backend:** la pestaña cmux de un plan sin historia se llama por su issue, y la recuperación la lee de vuelta (tarea 5/7, user_comment en /start-plan) ([cfc4e2c](https://github.com/josemerca/control-tower-plugin/commit/cfc4e2c1adb6dd3a0ece75530966d2df8a6aea60))
* **backend:** la ruta de start-plan lee repo_list y arranca un plan por repo (tarea 3/4, repo_list en /start-plan) ([ea515bd](https://github.com/josemerca/control-tower-plugin/commit/ea515bd69505aa66940eac1e68bd97e750223482))
* **backend:** POST /start-plan acepta repo_list y arranca un plan por repo ([743cf16](https://github.com/josemerca/control-tower-plugin/commit/743cf165eb367b9f37bc53ff138f7857e3153b5d))
* **backend:** POST /start-plan acepta user_comment, id pasa a ser opcional y un cuerpo sin ninguno de los dos se rechaza por su nombre (tarea 7/7, user_comment en /start-plan) ([1371ab6](https://github.com/josemerca/control-tower-plugin/commit/1371ab62fd901a35fed820a98f4e2be63e75f88b))
* **backend:** POST /start-plan acepta user_comment, y sin historia de Jira abre el issue desde el comentario ([d89e415](https://github.com/josemerca/control-tower-plugin/commit/d89e4152a37d435bf19f545ae9aee2e5c94df1df))
* **backend:** StartPlan planifica desde un comentario sin preguntar a Jira, y el comentario llega a open (tarea 1/7, user_comment en /start-plan) ([0078d8a](https://github.com/josemerca/control-tower-plugin/commit/0078d8aaeb12bad202f20a37eb794486b38ec1e7))
* **backend:** StartPlan planifica una lista de destinos, con el arranque de un repo intacto (tarea 1/4, repo_list en /start-plan) ([9234b92](https://github.com/josemerca/control-tower-plugin/commit/9234b921c5b4874785adc5a700da0a2924ea464b))
* **backend:** un issue sin historia de usuario nace del comentario: título, primera línea y contexto (tarea 3/7, user_comment en /start-plan) ([a5608fc](https://github.com/josemerca/control-tower-plugin/commit/a5608fcad128e5803c87046dea24c3bbed64a51b))
* **conventions:** la vara de ct se hace agnóstica y hereda lo que el backend pagó ([1ec89b9](https://github.com/josemerca/control-tower-plugin/commit/1ec89b98a00e7109ef9b8752db5fcd779a7d577c))
* el segundo veto escala a un consejero en vez de repetir el intento a ciegas ([3252e3a](https://github.com/josemerca/control-tower-plugin/commit/3252e3a8c69a815388b943b72481f4f413088de5))
* hand the watch over to the pull request when implementation starts ([c8737d5](https://github.com/josemerca/control-tower-plugin/commit/c8737d5fd1517fe920868653824fddfc146b008a))
* keep the stream alive through the delivery of a plan ([33131e6](https://github.com/josemerca/control-tower-plugin/commit/33131e69d251bbf6eaa17749fc6fdc983c55129b))
* pedir fixes en la pull request de un plan ([cf9919d](https://github.com/josemerca/control-tower-plugin/commit/cf9919d9569bfd3552073cf9ddc4d06836942a37))
* **plugin:** el paso advise, declarado en los dos lados del contrato ([0b8ce48](https://github.com/josemerca/control-tower-plugin/commit/0b8ce4874c4b461419fafaf2308326b7f7316c38))
* read the fixes asked for only while the issue stands in review ([0a92591](https://github.com/josemerca/control-tower-plugin/commit/0a925911d763dc725ace1a89e227de3d10fd556e))
* read the reviews of a pull request as changes asked for ([7a4eebe](https://github.com/josemerca/control-tower-plugin/commit/7a4eebe302ac1653cbdc93dedec81c2f0ccae405))
* reopen the slice before typing the fixes into its agent ([033eafc](https://github.com/josemerca/control-tower-plugin/commit/033eafc26a1d4b3a518c40666b080da9f2930c3b))
* send a reviewed slice back to the workbench ([d27dd5d](https://github.com/josemerca/control-tower-plugin/commit/d27dd5d9389b7369d3aa485725fe127e44f78faa))
* the review of a pull request continues main's implementation progress ([37bddbb](https://github.com/josemerca/control-tower-plugin/commit/37bddbbd4197be955d6f5f797161615bc12d5f07))
* wire the pull request review watch into the entrypoint ([34438fa](https://github.com/josemerca/control-tower-plugin/commit/34438fa551d653abface0e387d5ff65542e3b8b6))
* word the errand that asks the agent to fix its pull request ([ef3fb45](https://github.com/josemerca/control-tower-plugin/commit/ef3fb4535c117c67bc2805025d6969280c2c3acc))


### Correcciones

* a plan that was already implementing gets its pull request watched again ([891fbee](https://github.com/josemerca/control-tower-plugin/commit/891fbee68dec52400c17d304998c6b0e09c23b8c))
* a transient read failure during delivery no longer forgets the session ([f65f28d](https://github.com/josemerca/control-tower-plugin/commit/f65f28de37f0077a7a731491e9c0b05e75302c5d))
* **backend:** la cosecha del review de la rama repo_list en /start-plan — registro invisible del listado, el 400 post-preflight que dependía de un throw imposible, y el resto del punch list (0-riesgo, 7/7) ([b53537d](https://github.com/josemerca/control-tower-plugin/commit/b53537d5baee345c4175558ac108b73c67bc8696))
* **backend:** las tres rutas GET rechazan igual un verbo que no sirven ([1d5e266](https://github.com/josemerca/control-tower-plugin/commit/1d5e266a527b813073f568251d19567448174146))
* **backend:** lo que el juez del slice señaló como minor — el prefijo issue- se deriva una vez, los tests fijan los literales, el puerto describe su firma y PlanComment pierde el toString sin llamador (user_comment en /start-plan) ([d0ca853](https://github.com/josemerca/control-tower-plugin/commit/d0ca853f78389ebf61e5627f50da544ef2b44d99))
* **backend:** no dar por arrancada una implementacion cuyo run file aun no existe ([a9a1f41](https://github.com/josemerca/control-tower-plugin/commit/a9a1f41d9c1627a7b8b72a3acbb89a8e0122dc84))
* **backend:** quita del documento propio las reglas generales que viajaron pegadas, y añade la comprobación inversa ([6e8360e](https://github.com/josemerca/control-tower-plugin/commit/6e8360e733d8b61d61d3e7e2e4b448c331d562ff))
* **backend:** recuperar como implementing un go sin marcador si el run file muestra trabajo en marcha ([eda24ae](https://github.com/josemerca/control-tower-plugin/commit/eda24ae92917f884bbe28fba22bbf80f8253cf36))
* **backend:** repone ocho reglas propias que el borrado dejó sin dueño y cierra el punto ciego del test de la vara ([ccb9d72](https://github.com/josemerca/control-tower-plugin/commit/ccb9d724ff52d792e7b424d1701c98657a8198ab))
* **backend:** un go anterior al registro de marcadores ya no bloquea la app para siempre ([a85373e](https://github.com/josemerca/control-tower-plugin/commit/a85373e1a8f10b5a1914666d4fa4eece25f7873d))
* **backend:** una lista donde arrancó ninguno responde 400 no-plan-started con failed, no un 202 vacío (tarea 4/4, repo_list en /start-plan) ([c253c92](https://github.com/josemerca/control-tower-plugin/commit/c253c9268905f41e447fe53d0f5704f3be9ba3ed))
* **convenciones:** donde corre la suite se queda con el comando, sin reescribir el cierre de la vara ([87e7525](https://github.com/josemerca/control-tower-plugin/commit/87e75253a719f6fbea691cc76dbbd3802633ab15))
* **convenciones:** el comando de la suite rapida vuelve a estar escrito, y la captura se declara ([8af7a75](https://github.com/josemerca/control-tower-plugin/commit/8af7a75275155000a022a05fbbd58f9f53088973))
* **conventions:** repone el layout propio, da regla a la forma servicio y corrige las cifras ([5f9080b](https://github.com/josemerca/control-tower-plugin/commit/5f9080be3ed9fe605c73441132aba84e2809401a))
* deliver at most one review change per tick ([25dddb7](https://github.com/josemerca/control-tower-plugin/commit/25dddb75cf4deff53095df4c251fc4c30a42af35))
* drop PlanSessions.forget with no caller left ([507dbf5](https://github.com/josemerca/control-tower-plugin/commit/507dbf5e4fff0f3dde33931d1606ec0c55379ba4))
* keep issueNumber a bare number through the pull request fix lane ([c1f1dc0](https://github.com/josemerca/control-tower-plugin/commit/c1f1dc0a5de3e83bbf0d42f93e0301ca262b7cca))
* la deuda del progreso de la implementación y los huecos del juez adversarial ([b72d843](https://github.com/josemerca/control-tower-plugin/commit/b72d84376c54df1dd370050fb700090cf23bd5ed))
* one Gh client shared, and isInReview names its own read failure ([3aa704a](https://github.com/josemerca/control-tower-plugin/commit/3aa704ae1befba401720b0123c4c42e1f4bdb255))
* paginate the pull request reviews and line comments gh reads ([9a9bc83](https://github.com/josemerca/control-tower-plugin/commit/9a9bc8372ed25a346062d550506d7f31b0562c17))
* pin gh api reads of a pull request to GET, never a write ([c4a6096](https://github.com/josemerca/control-tower-plugin/commit/c4a609645e6d35b453cf3172a8dd2ab93aabef6b))
* where a plan issue stands travels as the vocabulary it is, not as a boolean ([8a89864](https://github.com/josemerca/control-tower-plugin/commit/8a89864a378ea0a99fbeb7ea131051200c10678a))


### Refactorizaciones

* **backend:** lo que era general subió a la vara; aquí queda lo propio ([9abe889](https://github.com/josemerca/control-tower-plugin/commit/9abe88926db3c3cf4ad85881f548a9d645c463bc))
* make the review watch name what it watches ([05f8c64](https://github.com/josemerca/control-tower-plugin/commit/05f8c6470c7a4174d3f56a70c873c5c92209892c))
* move ChangeAsked to the domain for its second constructor ([b132507](https://github.com/josemerca/control-tower-plugin/commit/b132507517ab1e4d4f66b1f14ba6edc7575df5e2))
* PlanWatch drops the delivering flag the merge left behind ([2118853](https://github.com/josemerca/control-tower-plugin/commit/2118853ec4987491388bfbe60ed78c03b804d4c2))
* the loop's branch prefix comes from the plugin that owns it ([b03cfce](https://github.com/josemerca/control-tower-plugin/commit/b03cfceb25244dcbb3ca3f89bf44ad755115deea))
* the status vocabulary needs no method for its own contract test ([1d2f032](https://github.com/josemerca/control-tower-plugin/commit/1d2f03260f266112d5a08617538d7c5b4a305f8b))
* underReview stops repeating what TASKLESS already decided ([6c38097](https://github.com/josemerca/control-tower-plugin/commit/6c3809776480a0c83401842b7afb8ad8a3326369))


### Documentación

* **backend:** el contrato de la API esta escrito, endpoint por endpoint ([72c3eec](https://github.com/josemerca/control-tower-plugin/commit/72c3eec833bf8682fd9979465308e16a2ade4f65))
* **backend:** el contrato de la API esta escrito, endpoint por endpoint ([3a2c099](https://github.com/josemerca/control-tower-plugin/commit/3a2c099403a5133e504d2a59c523f3c69dc999ec))
* measure an adapter against a declared shape, not a captured one ([dcdde1e](https://github.com/josemerca/control-tower-plugin/commit/dcdde1e53b4b2e2404141c6f84bb8b807548a1c6))
* the words this loop added enter the ubiquitous language ([0afdfa9](https://github.com/josemerca/control-tower-plugin/commit/0afdfa93f16605534eeab26effc2d7da41c809f2))

## [0.2.0](https://github.com/josemerca/control-tower-plugin/compare/backend-v0.1.0...backend-v0.2.0) (2026-09-07)


### Funcionalidades

* **backend:** el encargo del agente de plan señala el baseline, ya no lo ordena ([43721fb](https://github.com/josemerca/control-tower-plugin/commit/43721fb1a924e3a1ddfa689664a2654f583eb73a))
* **backend:** GitWorkspace mide el baseline del worktree que prepara ([766f3f7](https://github.com/josemerca/control-tower-plugin/commit/766f3f770dc60638640f74d3a9fd19f42fa6d9c4))
* el baseline lo mide el programa, no lo afirma el agente ([1ad63b9](https://github.com/josemerca/control-tower-plugin/commit/1ad63b9edfb3c8099554be62899ff5462f25ecfa))
* la vara viaja por alcance, la precedencia se escribe una vez y el token lo pone el programa ([76a895f](https://github.com/josemerca/control-tower-plugin/commit/76a895fc0a1fd4039f66e36593dfd4613acb4982))


### Correcciones

* restore active workflows after restart ([6bc31b3](https://github.com/josemerca/control-tower-plugin/commit/6bc31b303b08a9917912bee0470a31d6eb7be83f))


### Refactorizaciones

* **backend:** errandFor importa la cabecera de la vara en vez de repetir la regla ([a2e8694](https://github.com/josemerca/control-tower-plugin/commit/a2e8694fb40469fd6dda22e7314f666aefdd9309))
