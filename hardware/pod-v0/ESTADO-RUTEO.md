# Estado del ruteo de 6 capas (WIP, borrar antes del PR)

Rama `feat/278-pod-v0-6-capas` (B-909, #278). Actualizado el 25/11/2026.

## Placa

- `pod-v0.kicad_pcb`: el mejor resultado hasta ahora (E2). DRC limpio (solo las 20 advertencias de biblioteca de
  siempre), **31 conexiones sin rutear en 22 redes**.
- `ruteo-base-e2.kicad_pcb`: la misma placa justo después de `resto` (antes de `planos`); es la entrada de
  `reparar`. Rehacerla desde cero lleva unas 5 h.

Stackup: L1 señales + RF, L2 GND, L3 señales + relleno GND, L4 señales + relleno GND (VREG por pistas), L5 GND,
L6 señales.

## Cómo se llegó (en orden)

`seis-capas` → `criticas` → `abanico` → `resto` (24 vueltas) → `planos` → `remate` → `podar`.
Las redes especiales (GNSS_SENSITIVE, POWER_DOCK) **no** se bloquean antes: rutearlas con el resto fue lo que bajó de
102 a 31 conexiones (bloqueadas encerraban pads de otras redes).

## Probado y descartado

| Intento | Resultado |
|---|---|
| Quilter (6 capas, especiales bloqueadas) + nuestro router | 100 sin rutear, 17 errores de separación (Quilter no lee las reglas de KiCad) |
| Freerouting 2.5.0 en 6 capas | 190-235 sin rutear tras 12 pasadas |
| Isla de VREG en L4 (`rutear.py isla`) | peor que E2 a la misma vuelta (84 vs 61 redes compartiendo cobre) |
| `reparar` levantando rectángulos y rieles | 74 sin rutear (los rieles no volvieron a entrar) |

## Arreglos de este tramo

- `laberinto.py` / `rutear.py`: `board.Delete` en vez de `board.Remove` (Remove dejaba objetos a medio liberar y
  pcbnew se caía al azar: segfault / bus error). No alcanzó: E5 se cayó igual en la vuelta 14 **durante el garbage
  collector**, así que `route_all` ahora corre con `gc.disable()`. Sin probar todavía con ese cambio: si se vuelve a
  caer, mirar el traceback (`python3 -X faulthandler`).
- Docker con 4 GB: una sola corrida del router a la vez (cada una usa ~2,3 GB).
- `rutear.py resto --vueltas N`, `rutear.py reparar` (levanta las redes sin terminar y las de señal que cruzan un
  pasillo de 1 mm a lo largo de cada conexión faltante; los rieles quedan fijos), `rutear.py isla` (descartada).

## Siguiente

1. Correr `reparar` sobre `ruteo-base-e2.kicad_pcb` y después `planos`, `remate`, `podar` (E5) y comparar contra
   las 31 de E2. E5 venía mejor que E2 (45 redes compartiendo cobre en la vuelta 14 contra 56) cuando se cayó.
2. Con más memoria: `resto --vueltas 48` desde `abanico` (E2 seguía bajando: 54 → 30 redes compartiendo cobre).
3. Lo que quede: la mitad está en la esquina superior izquierda (drivers de LED, level shifters del GNSS, tiradas
   largas desde el MCU por la franja x < 10): mover dos o tres partes ahí o terminar a mano en KiCad.
4. Después: docs (L4 = señal, VREG por pistas), `--fallar-sin-rutear` en el CI, PR con review y CI verde.

Comandos (desde la raíz del repo, imagen de CI `kicad/kicad:10.0.8@sha256:3f4a0178…`):

```sh
python3 hardware/tools/rutear.py reparar --placa <copia de ruteo-base-e2> --vueltas 24
python3 hardware/tools/rutear.py planos --placa <placa>
python3 hardware/tools/rutear.py remate --placa <placa>
python3 hardware/tools/rutear.py podar --placa <placa>
kicad-cli pcb drc --severity-error --severity-warning --format json --output drc.json <placa>
```
