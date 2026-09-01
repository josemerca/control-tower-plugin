#!/usr/bin/env node
// Grabadora para CT_WATCH_GO_BIN: apunta su argv en un fichero y se muere.
//
// Sustituye al vigilante de verdad en los tests de ct-next. Sin ella, cada test
// que despacha un slice pondría un proceso REAL a sondear GitHub cada 30
// segundos durante ocho horas — y hay muchos tests que despachan.
//
// CT_WATCH_GO_BIN no es un modo de prueba encubierto: sigue el patrón de
// CT_ACCOUNT_*_DIR, o sea que no cambia NINGUNA decisión de ct-next, sólo qué
// programa se lanza. Lo que el test comprueba —que se lanza, y con qué
// argumentos— es exactamente lo que importa de esa costura.
import { appendFileSync } from 'node:fs'

const destino = process.env.FAKE_WATCH_GO_LOG
if (destino) appendFileSync(destino, JSON.stringify(process.argv.slice(2)) + '\n')
