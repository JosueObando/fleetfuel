# La puerta de cobertura

`npm run test:cobertura` corre **las unitarias y las de integración juntas** y
mide una sola vez. Es el número honesto del proyecto.

## Por qué el umbral no es 80

Al ponerlo, la base estaba en 63 %. Un umbral de 80 rompería CI en el commit
siguiente, y lo que pasa entonces no es que alguien escriba pruebas: es que
alguien baja el número, o añade `--passWithNoTests`, o quita el paso. El umbral
muere y se lleva por delante la costumbre.

Así que es un **trinquete**: se puso justo por debajo de lo que ya había.

| | al ponerlo | umbral |
|---|---|---|
| Sentencias | 63,47 % | 62 |
| Ramas | 42,52 % | 41 |
| Funciones | 46,48 % | 45 |
| Líneas | 66,18 % | 65 |

**La regla de uso: cuando la cobertura suba, súbelo.** Nunca al revés. Bajarlo
para que pase un commit es exactamente el fallo que el trinquete existe para
impedir, y si algún día hay que hacerlo, que sea una decisión escrita y no un
`-1` en un fichero.

## Por qué antes decía 9 %

`test:cov` medía sólo `--config test/jest.unit.json`, y las pruebas de
integración iban aparte. Peor: esas pruebas no tenían `collectCoverageFrom`, así
que Jest sólo instrumentaba los ficheros que ellas importaban —siete sentencias
en total— y su informe decía **100 %**. Dos números, los dos ciertos y los dos
inútiles: uno demasiado bajo porque le faltaba media suite, otro perfecto porque
medía casi nada.

## Qué queda fuera de la medida a propósito

Los DTO y las entidades. Son declaraciones con decoradores: cubrirlos sube el
porcentaje sin comprobar ni una regla, que es la forma más rápida de convertir
la cobertura en un número que no significa nada. También quedan fuera las
migraciones y las semillas, que se verifican ejecutándolas (`migration:revert`
en CI), no midiéndolas.
