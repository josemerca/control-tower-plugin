# Changelog

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
