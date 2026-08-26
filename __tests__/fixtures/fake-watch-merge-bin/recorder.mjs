#!/usr/bin/env node
// Grabadora para CT_WATCH_MERGE_BIN: apunta su argv en un fichero y se muere.
//
// Sustituye al vigilante del merge de verdad en los tests. Sin ella, cada test
// que libera un slice pondría un proceso REAL a sondear GitHub cada minuto
// durante 48 horas — y `--release` se ejercita en muchos tests, no sólo en los
// que hablan de esto. Es la lección de CT_WATCH_GO_BIN, que la suite aprendió
// dejando 42 procesos huérfanos en su primera corrida.
//
// CT_WATCH_MERGE_BIN no es un modo de prueba encubierto: sigue el patrón de
// CT_WATCH_GO_BIN y de CT_ACCOUNT_*_DIR, o sea que no cambia NINGUNA decisión de
// dispatch-check, sólo qué programa se lanza. Lo que el test comprueba —que se
// lanza, y con qué argumentos— es exactamente lo que importa de esa costura.
import { appendFileSync } from 'node:fs'

const destino = process.env.FAKE_WATCH_MERGE_LOG
if (destino) appendFileSync(destino, JSON.stringify(process.argv.slice(2)) + '\n')
