"""Routing of the pod v0 board (B-909). One-shot tool, like ``ubicar.py``: after it runs, the board is the source.

Runs inside the official KiCad image (it needs KiCad's ``pcbnew`` module). The board was routed in 4 layers on
16/11/2026, is 6 layers since 23/11/2026 (``seis-capas``) and was routed whole on 26/11/2026 (again, tidier, on
27/11/2026, and without vias in the pads on 28/11/2026), on a copy of the placed board, with ``limpiar``,
``criticas --forzar``, ``abanico``, ``resto --vueltas 128``, ``reparar --margen 0.5``, ``planos``, ``remate``,
``podar``, ``rescate`` and ``podar``, then ``retocar`` rounds on what was left (``hardware/README.md``, "Ruteo").

``seis-capas``
    The 4-layer board of 22/11/2026 to 6 layers: see ``seis_capas``.

``limpiar``
    Every track and via out, and the planes of ``planos``: the start of a new routing from the placed board.

``criticas``
    Moves the few passives listed in ``MOVES`` (each with its reason) and routes, by script and locked, the nets
    that must not be left to an autorouter: both RF chains (CPWG of ``RF_50`` on L1, the patch feed on the bottom
    layer with its RF via) with their GND via fences, the USB pair (bottom layer, vias at x >= 14.5), the escape
    of the BMD-340 (every used pad to a via: the two top rows by L1 to two rows of vias above the module, the rest
    with a short track to a via next to the pad, never in it), the crystal, VBUS from the spring through the TVS and the eFuse to the BMD-340 and the
    charger, BAT and SYS around the charger (with the cell sense of the MAX17048 on its own trace from the pad of
    ``J101``), the buck-boost (switch node, input and output loops), DETECT and the pads that the router left
    walled in run after run (``pads_encerrados``). Written for 4 layers: its bottom layer (then L4) is L6. Refuses
    to run on a board that already has tracks (``--forzar`` to run it on a scratch copy anyway).

``abanico``
    A GND via next to every SMD GND pad without one within 1 mm, down to the planes of L2 and L5, before ``resto``
    takes the room around the pads.

``resto``
    Routes everything else but GND with the maze router of ``laberinto.py`` on L1, L3, L4 and L6 (negotiated
    congestion; ``--vueltas`` rounds at most).

``planos``
    Adds the GND fill of L1, L3, L4 and L6, the stitching vias (around the RF, along the board edge and over the
    whole board) and a GND via next to every GND pad that the fill leaves unconnected, and fills the zones.

``remate``
    Routes what is still not joined over the free space that is left, and fills again.

``podar``
    Takes away what the DRC flags of the router's copper and the dangling copper, stitches loose pieces of the
    GND fill and refills.

``rescate``
    A via for a GND pad that the tracks walled in, rerouting the signals it runs into.

``reparar [--margen mm]``
    After ``resto``: rips up the unfinished nets and every signal net with copper within ``--margen`` mm (1 by
    default) of the straight line of each missing connection, and routes them again together.

``retocar [--radio mm]``
    After ``podar``: like ``reparar``, but rips up only the signal nets with copper within ``--radio`` mm (1.5 by
    default) of the two ends of each missing connection, so a long one does not take half the board with it.
    Followed by ``planos``, ``remate``, ``podar``, ``rescate`` and ``podar``; the radius changes what comes out.

``dsn <out.dsn>`` and ``ses <in.ses>``
    Freerouting (tried, not used): see ``dsn_for_freerouting``. ``isla``, ``rieles``, ``especiales`` and
    ``bloquear`` are other steps that were tried and not used on the board (``hardware/README.md``).

    docker run --rm -e HOME=/tmp -v "$PWD:/work" -w /work kicad/kicad:10.0.8@sha256:… \\
        python3 hardware/tools/rutear.py criticas [--placa otra.kicad_pcb] [--forzar]

Coordinates are the ones of ``docs/hardware/pod-v0-ubicacion-y-carcasa.md``: origin (0; 0) = (100; 100) in
KiCad, x to the right, y down, seen from the patch side. ``hardware/README.md`` has the whole procedure.
"""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pcbnew

TOOLS = Path(__file__).resolve().parent
POD = TOOLS.parent / "pod-v0"
ORIGIN = (100.0, 100.0)

RF = 0.33  # RF_50 CPWG on L1 and the patch feed on the bottom layer (pod-v0.kicad_dru)
USB = 0.25  # USB_90D, pair gap 0.15
PWR = 0.5  # POWER_DOCK on the outer layers
VIA_RF = (0.6, 0.3)
VIA_PWR = (0.6, 0.3)
VIA_SIG = (0.5, 0.2)  # smallest via that meets PCBWay's minimums (0.45 mm, 0.2 mm hole, 0.15 mm ring)

LAYERS = {"F": pcbnew.F_Cu, "In1": pcbnew.In1_Cu, "In2": pcbnew.In2_Cu, "In3": pcbnew.In3_Cu, "In4": pcbnew.In4_Cu,
          "B": pcbnew.B_Cu}
ALL_CU = [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.In3_Cu, pcbnew.In4_Cu, pcbnew.B_Cu]

GRILLA = "rejilla de resistencias de abajo abierta: con 0,44 mm entre pads, los de adentro no tenían salida"
BB_CFG = "pull-down de CFG1 del buck-boost al oeste: su fila queda para las vías de CFG2 y CFG3"
COLUMNA_LED = "columna de resistencias de los LED a 1,2 mm: con 1,1 no pasaba una pista entre pads"
# Passives moved while routing: (ref, x, y, rotation) and why. Small moves only (hardware/README.md, "Ruteo").
MOVES = {
    # TPS63900 (SLVSET3D, "Layout guidelines"): the inductor next to LX1/LX2 and the input and output capacitors
    # next to VIN, VOUT and GND, with the shortest loops. With the inductor south of the IC (where the placement
    # had it) both switch nodes had to cross VOUT: it goes to the east side, standing, so pad 1 faces LX1 (pin 9)
    # and pad 2 faces LX2 (pin 7), 0.65 mm from the pins (courtyard against courtyard).
    "L101": (22.9, 62.0, 270, "inductor del buck-boost al lado de LX1/LX2 (hoja del TPS63900, layout)"),
    "C105": (22.4, 59.65, 0, "capacitor de entrada pegado a VIN (pin 10), con el SYS hacia el pin"),
    "C106": (20.1, 64.35, 180, "capacitor de salida pegado a VOUT (pin 6) y al pad expuesto"),
    # BQ25180 (DSBGA, 0.4 mm): the four balls of each row escape straight out of their row. SYS (B2) leaves to the
    # north, so its capacitor goes north; BAT (C2) and GND (D2) leave to the north and east, so C103 turns with
    # its GND pad facing D2.
    "C102": (15.65, 63.0, 0, "capacitor de SYS del cargador al norte, donde sale la bola B2"),
    "C103": (16.6, 65.0, 90, "capacitor de BAT del cargador girado: su pad de GND frente a la bola D2"),
    # TPS63900: the pull-downs of CFG1 to CFG3 sat in a column on the bottom side right under the only free copper of
    # L1 next to the pins (walled in by SYS, C102, BAT and the pins): no via fitted between their pads (0.48 mm), and
    # two of the three nets were left open run after run (26/11/2026). R105 (CFG1) goes west, standing, next to the
    # via that CFG1 takes anyway; its row is left for the vias of CFG2 and CFG3 (``pads_encerrados``).
    "R105": (16.3, 60.8, 90, BB_CFG),
    # BMD-340: VREG (pad 65) reaches its 100 nF and 4.7 uF on L1 with their VREG pad on the side of the pad. Both
    # 0.75 and 0.4 mm further east since 27/11/2026: x 15.1 and 15.85 take the two columns of vias of its east pads
    # (no via in its pads).
    "C302": (16.6, 55.5, 270, "100 nF del BMD-340 girado, al este de las dos columnas de vías de sus pads"),
    "C301": (17.9, 55.5, 270, "4,7 uF del BMD-340 girado, al este de las dos columnas de vías de sus pads"),
    # LNA (U205, BGA525N6 at 0.4 mm): its control (CTRL1, pad 6) and supply (VCC, pad 2) pins sit between the RF
    # pads, so they leave west, between two capacitors that had to make room: C219 (VCC) turns and goes down 0.3 mm
    # with its VCC pad facing the LNA, and C220 (not mounted) moves out to the west.
    "C219": (23.5, 43.9, 180, "100 nF del LNA girado y bajado: VCC frente al pad 2 y lugar para el GND del pad 1"),
    "C220": (22.0, 44.0, 90, "capacitor sin montar del LNA corrido al oeste: dejaba sin salida al control (pad 6)"),
    # The via of CTRL2 (pad 4) sits between the LNA's RF pads and its pull-down's pads, on L6: R214 moves east so
    # the via's hole is 0.15 mm or more from its pad 1 (no via in a pad, no resin fill), and R215 (pull-up) and C403
    # (the IMU's capacitor, to the east) with it.
    "R214": (26.78, 42.6, 270, "pull-down del control 2 del LNA 0,18 mm al este: la vía quedaba a 0,02 mm del pad 1"),
    "R215": (27.82, 42.6, 270, "pull-up del control 2 del LNA 0,12 mm al este, junto con R214"),
    "C403": (29.3, 43.5, 0, "100 nF del ICM-42688-P 0,1 mm al este, para que entren R214 y R215 sin que se toquen"),
    # MAX17048: its BAT pins (2 and 3) are the middle two of the bottom row and C309 (the input capacitor of the
    # LoRa load switch) sat 0.29 mm below them, so they had no way out. C309 goes to the left of the load switch,
    # right above its VREG_LORA pin (pin 1).
    "C309": (27.3, 51.75, 180, "capacitor de VREG_LORA al lado del pin 1 de U303: dejaba encerrados los pines BAT del MAX17048"),
    # BMD-340: its second top row escapes to a row of vias at y = 48.3; R501 (the 22 ohm of NAND_SCK, bottom side,
    # under pad 37) sat on that row.
    "R501": (10.4, 47.45, 0, "22 ohm de NAND_SCK corrido 1,35 mm al este: pisaba la fila de vías del escape del BMD-340"),
    # The grid of 0402 pull-ups and dividers under the NAND and the MAX17048 (bottom side): 1.1 mm between rows and
    # 2 mm between columns left 0.44-0.46 mm between pads, so no pad inside the grid had a way out (a 0.15 mm track
    # needs 0.45 mm). Standing, in 6 columns 1.6 mm apart and 3 rows 2.1 mm apart: a via or two tracks between
    # columns, a track between rows.
    # The column of LED resistors (top side, west of GNSS_ANTENA): 1.1 mm between rows left 0.46 mm between pads, so
    # LED_DG and LED_DB (east pads, the antenna to the east) had no way out to the west (25/11/2026). 1.2 mm.
    "R310": (8.65, 10.8, 0, COLUMNA_LED),
    "R316": (8.65, 12.0, 0, COLUMNA_LED),
    "R311": (8.65, 13.2, 0, COLUMNA_LED),
    "R317": (8.65, 14.4, 0, COLUMNA_LED),
    "R312": (8.65, 15.6, 0, COLUMNA_LED),
    "R318": (8.65, 16.8, 0, COLUMNA_LED),
    "R308": (8.65, 18.0, 0, COLUMNA_LED),
    "R309": (8.65, 19.2, 0, COLUMNA_LED),
    "R306": (17.9, 50.2, 90, GRILLA),
    "R307": (19.5, 50.2, 90, GRILLA),
    "R303": (21.1, 50.2, 90, GRILLA),
    "R322": (22.7, 50.2, 90, GRILLA),
    "R323": (24.3, 50.2, 90, GRILLA),
    "R301": (25.9, 50.2, 90, GRILLA),
    "R302": (17.9, 52.3, 90, GRILLA),
    "R304": (19.5, 52.3, 90, GRILLA),
    "R324": (21.1, 52.3, 90, GRILLA),
    "R503": (22.7, 52.3, 90, GRILLA),
    "R505": (24.3, 52.3, 90, GRILLA),
    "R506": (25.9, 52.3, 90, GRILLA),
    "R502": (17.9, 54.4, 90, GRILLA),
    "R507": (19.5, 54.4, 90, GRILLA),
    "R508": (21.1, 54.4, 90, GRILLA),
    "R504": (22.7, 54.4, 90, GRILLA),
}


def mm(v: float) -> int:
    return pcbnew.FromMM(v)


def pt(x: float, y: float) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(x + ORIGIN[0]), mm(y + ORIGIN[1]))


class Router:
    """Adds tracks and vias in document coordinates; every item it adds is locked."""

    def __init__(self, board):
        self.board = board
        self.nets = {str(k): v for k, v in board.GetNetsByName().items()}
        self.fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
        self.added = []

    def net(self, name: str):
        found = [k for k in self.nets if k == name or k.endswith("/" + name)]
        if len(found) != 1:
            raise SystemExit(f"red {name}: {found}")
        return self.nets[found[0]]

    def pad(self, ref: str, num: str) -> tuple[float, float]:
        pads = [p for p in self.fps[ref].Pads() if p.GetNumber() == num]
        if not pads:
            raise SystemExit(f"{ref}.{num}: no existe")
        # the biggest copper of that number (a mounting hole has a ring of small pads with the same number)
        p = max(pads, key=lambda q: q.GetBoundingBox().GetArea()).GetPosition()
        return pcbnew.ToMM(p.x) - ORIGIN[0], pcbnew.ToMM(p.y) - ORIGIN[1]

    def xy(self, p):
        if isinstance(p, str):
            ref, num = p.split(".", 1)
            return self.pad(ref, num)
        return p

    def track(self, net: str, layer: str, width: float, pts: list) -> float:
        pts = [self.xy(p) for p in pts]
        n = self.net(net)
        length = 0.0
        for a, b in zip(pts, pts[1:]):
            if a == b:
                continue
            t = pcbnew.PCB_TRACK(self.board)
            t.SetStart(pt(*a))
            t.SetEnd(pt(*b))
            t.SetWidth(mm(width))
            t.SetLayer(LAYERS[layer])
            t.SetNet(n)
            t.SetLocked(True)
            self.board.Add(t)
            self.added.append(t)
            length += math.dist(a, b)
        return length

    def via(self, net: str, p, size: tuple = VIA_SIG):
        x, y = self.xy(p)
        v = pcbnew.PCB_VIA(self.board)
        v.SetPosition(pt(x, y))
        v.SetWidth(mm(size[0]))
        v.SetDrill(mm(size[1]))
        v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        v.SetNet(self.net(net))
        v.SetLocked(True)
        self.board.Add(v)
        self.added.append(v)
        return v


# ---------------------------------------------------------------------------------------------------- moves
def apply_moves(board) -> list[str]:
    fps = {fp.GetReference(): fp for fp in board.GetFootprints()}
    done = []
    for ref, (x, y, rot, why) in MOVES.items():
        fp = fps[ref]
        old = (pcbnew.ToMM(fp.GetPosition().x) - ORIGIN[0], pcbnew.ToMM(fp.GetPosition().y) - ORIGIN[1],
               fp.GetOrientationDegrees())
        fp.SetPosition(pt(x, y))
        fp.SetOrientationDegrees(rot)
        done.append(f"{ref}: ({old[0]:.2f}; {old[1]:.2f}) {old[2]:.0f}° -> ({x}; {y}) {rot}° ({why})")
    return done


# ---------------------------------------------------------------------------------------------- GNSS RF chain
def gnss_rf(r: Router) -> dict:
    lengths = {}
    # Patch feed: from the pin (pad of 2.2 mm on L4) down L4 over the GND of L3 to the RF via, then L1 to R206.
    lengths["GNSS_ANT_PATCH"] = r.track("GNSS_ANT_PATCH", "B", RF, ["AE201.1", (25.0, 31.0)])
    r.via("GNSS_ANT_PATCH", (25.0, 31.0), VIA_RF)
    lengths["GNSS_ANT_PATCH"] += r.track("GNSS_ANT_PATCH", "F", RF, [(25.0, 31.0), "R206.1"])
    # GND fence along the L4 feed (both sides, every 2 mm, L1 to L4) and around its RF via.
    for y in (21.5, 23.5, 25.5, 27.5, 29.5, 31.0):
        r.via("GND", (23.9, y), VIA_RF)
        r.via("GND", (26.1, y), VIA_RF)
    # Pin of the patch: at least 4 GND vias around its 3.5 mm clearance on L4.
    for dx, dy in ((-2.1, -1.2), (2.1, -1.2), (-2.1, 1.0), (2.1, 1.0)):
        r.via("GND", (25.0 + dx, 19.5 + dy), VIA_RF)
    # Node GNSS_ANT: R206 -> C217, ESD (D203) to the right, the U.FL capacitor (C214) to the left.
    r.track("GNSS_ANT", "F", RF, ["R206.2", "C217.1"])
    r.track("GNSS_ANT", "F", RF, [(25.0, 34.1), "D203.1"])
    r.track("GNSS_ANT", "F", RF, [(25.0, 34.1), "C214.2"])
    # RF_A: C217 -> SAW 1 (FL201.1); shunt L202 and the bypass R211 to the left.
    r.track("GNSS_RF_A", "F", RF, ["C217.2", (25.0, 36.62)])
    r.track("GNSS_RF_A", "F", RF, [(25.0, 36.15), "L202.1"])
    r.track("GNSS_RF_A", "F", RF, ["L202.1", (23.59, 36.8), "R211.1"])
    # RF_B: SAW 1 out (FL201.4) -> C218; shunt L203 and the LNA bypass R217 to the right, R211 to the left.
    r.track("GNSS_RF_B", "F", RF, [(25.29, 37.78), "C218.1"])
    r.track("GNSS_RF_B", "F", RF, [(25.3, 38.3), (25.9, 38.3), "L203.1"])
    r.track("GNSS_RF_B", "F", RF, ["L203.1", "R217.1"])
    r.track("GNSS_RF_B", "F", RF, ["R211.2", (25.3, 38.26)])
    # RF_LNA, LNA_IN, LNA_OUT: C218 -> L204 -> LNA (U205) -> R216.
    r.track("GNSS_RF_LNA", "F", RF, ["C218.2", "L204.1"])
    r.track("GNSS_LNA_IN", "F", RF, ["L204.2", (25.3, 42.72)])
    r.track("GNSS_LNA_OUT", "F", RF, [(25.7, 43.28), (25.7, 43.2), (26.15, 43.2), (26.15, 43.8), (25.85, 44.1)])
    # LNA support pins (rule "RF_50: alrededor del LNA"): CTRL1 west to its pull-up (R212) and pull-down (R213, not
    # mounted); VCC south and west to its capacitor (C219); GND (pad 1) west to C219's GND; CTRL2 to a via and its
    # pull-down (R214) on L4.
    r.track("GNSS_LNA_CTRL1", "F", 0.15, ["U205.6", (22.6, 42.8), (22.45, 42.65), (22.45, 41.4), "R212.1"])
    r.track("GNSS_LNA_CTRL1", "F", 0.15, [(22.45, 41.4), (22.45, 40.3), "R213.1"])
    r.track("VCC_GNSS", "F", 0.15, ["U205.2", (25.3, 43.62), (24.2, 43.62)])
    r.track("GND", "F", 0.15, ["U205.1", (23.02, 43.2), "C219.2"])
    r.track("GNSS_LNA_CTRL2", "F", 0.15, ["U205.4", (26.2, 42.45)])
    r.via("GNSS_LNA_CTRL2", (26.2, 42.45))
    r.track("GNSS_LNA_CTRL2", "B", 0.15, [(26.2, 42.45), "R214.1", "R215.1"])
    # RF_C: R216 -> SAW 2 (FL202.1); shunt L205 to the right with the bypass R217 coming down; R218 to the left.
    r.track("GNSS_RF_C", "F", RF, ["R216.2", (25.6, 46.1)])
    r.track("GNSS_RF_C", "F", RF, [(25.6, 45.65), "L205.1"])
    r.track("GNSS_RF_C", "F", RF, ["R217.2", (27.0, 41.51), (27.0, 45.65)])
    r.track("GNSS_RF_C", "F", RF, [(25.6, 45.59), "R218.1"])
    # RF_D: SAW 2 out (FL202.4) -> attenuator R220; shunt L206 and R219 to the right, R218 to the left.
    r.track("GNSS_RF_D", "F", RF, [(25.89, 47.22), (25.89, 47.8), (26.9, 47.8)])
    r.track("GNSS_RF_D", "F", RF, ["L206.1", "R219.1"])
    r.track("GNSS_RF_D", "F", RF, [(25.89, 47.8), (24.5, 47.8), "R220.1"])
    r.track("GNSS_RF_D", "F", RF, ["R218.2", (23.9, 47.3), (24.5, 47.8)])
    # RF_E: R220 -> R222, with the shunts R221 and C221 below.
    r.track("GNSS_RF_E", "F", RF, ["R220.2", "R222.1"])
    r.track("GNSS_RF_E", "F", RF, [(23.12, 48.2), "C221.1"])
    r.track("GNSS_RF_E", "F", RF, [(21.09, 48.2), "R221.1"])
    # RF_IN: R222 -> C222 -> pad 11 of the LC29H, entering from below.
    lengths["GNSS_RF_IN"] = r.track("GNSS_RF_IN", "F", RF, ["R222.2", "C222.1", (18.28, 47.5), (14.7, 47.5),
                                                             (14.7, 46.9)])
    # U.FL branch (rescue antenna): C214 -> U.FL (J202) -> ESD (D204) -> bias-T inductor (L201).
    r.track("GNSS_ANT_UFL", "F", RF, ["C214.1", (21.9, 35.0), (20.6, 35.4), "J202.1"])
    r.track("GNSS_ANT_UFL", "F", RF, ["J202.1", (20.48, 35.4), "D204.1", "L201.1"])
    return lengths


# ---------------------------------------------------------------------------------------------- LoRa RF chain
def lora_rf(r: Router) -> dict:
    lengths = {}
    lengths["LORA_ANT"] = r.track("LORA_ANT", "F", RF, [(46.83, 53.0), "C310.1", "R325.1"])
    lengths["LORA_RF"] = r.track("LORA_RF", "F", RF, ["R325.2", "C311.1", "R327.1"])
    r.track("LORA_RF", "F", RF, [(46.8, 57.75), "R326.1"])
    lengths["LORA_ANT_CHIP"] = r.track("LORA_ANT_CHIP", "F", RF, ["R326.2", "R328.1"])
    r.track("LORA_ANT_CHIP", "F", RF, [(43.8, 57.75), "C312.1"])
    # Feed into the clearance of the chip antenna as on AVX's demo board (TDS-ANT-0048 rev. 4, p.5): along the edge
    # of the clearance, coplanar with the top-layer GND outside it (0.20 mm, the GND tongue of P2 at x > 42.7) and
    # with nothing under it, through P2's pad (C313.1) to pin 1 of AE301.
    lengths["LORA_FEED"] = r.track("LORA_FEED", "F", RF, ["R328.2", (41.79, 58.5), (42.335, 59.045), (42.335, 66.1), (41.97, 66.75),
                                                        (41.3, 67.75)])
    r.track("LORA_UFL", "F", RF, ["R327.2", "J302.1"])
    return lengths


# ---------------------------------------------------------------------------------------------------- USB
def usb(r: Router) -> dict:
    # Spring legs (DOCK_D_*): straight down from the springs, touching the outer end of each ESD pad (TPD2E2U06,
    # IO1 = pad 3 for D+, IO2 = pad 5 for D-), to the 0 ohm. They cannot be coupled: the springs are 3.5 mm apart.
    r.track("DOCK_D_P", "B", USB, [(18.0, 7.95), (18.3, 8.25), (18.3, 11.8), (18.85, 11.8)])
    r.track("DOCK_D_P", "B", USB, [(18.3, 11.8), (18.3, 14.45), "R608.1"])
    r.track("DOCK_D_N", "B", USB, [(21.5, 7.95), (21.2, 8.25), (21.2, 12.8), (20.65, 12.8)])
    r.track("DOCK_D_N", "B", USB, [(21.2, 12.8), (21.2, 14.45), "R609.1"])
    r.via("GND", (19.75, 10.95))  # GND of the ESD (pad 4) to L2, between the two legs
    r.track("GND", "B", 0.2, ["U601.4", (20.3, 11.6), (19.75, 10.95)])
    # The pair on the bottom layer (L4 when this was written for 4 layers, L6 today), 0.25 mm at 0.15 mm, west and
    # then down the L3_GND strip of then (x 14.5-17), up to L1 by one pair of
    # vias east of pads 68 and 67 (inside the strip) and on L1 to the pads. KiCad checks the gap of every pair of
    # parallel segments that overlap, so the uncoupled ends never run parallel to each other: D+ drops straight
    # from its 0 ohm and D- at 45 degrees, the 45-degree corner keeps the 0.4 mm pitch (outer chamfer 0.234 mm
    # longer) and D- reaches its pad at an angle.
    p = r.track("USB_D_P", "B", USB, ["R608.2", (18.8, 16.5), (16.034, 16.5), (15.6, 16.934), (15.6, 51.0),
                                      (15.35, 51.25)])
    n = r.track("USB_D_N", "B", USB, ["R609.2", (19.71, 16.9), (16.2, 16.9), (16.0, 17.1), (16.0, 52.05),
                                      (15.3, 52.85)])
    r.via("USB_D_P", (15.35, 51.25))
    r.via("USB_D_N", (15.3, 52.75))
    p += r.track("USB_D_P", "F", USB, [(15.35, 51.25), "U301.68"])
    n += r.track("USB_D_N", "F", USB, [(15.3, 52.75), "U301.67"])
    return {"USB_D_P": p, "USB_D_N": n}


# ---------------------------------------------------------------------------------------------------- DETECT
def detect(r: Router) -> None:
    r.track("DOCK_DET", "B", 0.25, [(28.5, 7.95), "D602.1", "R601.1"])


# ---------------------------------------------------------------------------------------------------- power
def vbus(r: Router) -> None:
    # From the spring (J601.1) to the TVS (D601), the input capacitor (C602) and the eFuse input (U602.5).
    r.track("VBUS_PAD", "B", PWR, [(32.9, 7.0), (33.6, 7.0), "C602.1"])
    r.track("VBUS_PAD", "B", PWR, [(33.6, 7.0), (35.1, 5.5), "D601.1"])
    r.track("VBUS_PAD", "B", PWR, ["D601.1", (35.6, 6.1), (36.9, 6.1), (37.49, 6.7), "R607.1"])
    r.track("VBUS_PAD", "B", 0.25, ["R607.1", (37.75, 8.0), (37.75, 8.7)])
    # eFuse output (U602.6) -> R607 (bypass, not mounted) -> down the right side on L4 (x 41.75, between the cell
    # and the edge, out of GNSS_ANTENA) and west on L4 at y 58.5, between the Ra-01SH and the LoRa clearance.
    r.track("VBUS", "B", 0.25, [(38.25, 8.7), (38.25, 8.0), "R607.2"])
    r.track("VBUS", "B", PWR, ["R607.2", (38.51, 7.2), (39.2, 6.6), (41.2, 6.6), (41.2, 12.0), (41.75, 12.55),
                               (41.75, 58.5), (15.3, 58.5)])
    # Up at pad 66 of the BMD-340 and its 4.7 uF (C303), east of the two columns of vias of the east pads of the
    # BMD-340 (x 15.1 and 15.85: no via in its pads since 27/11/2026).
    r.track("VBUS", "B", PWR, [(16.9, 58.5), (16.9, 53.9), (16.4, 53.4)])
    r.via("VBUS", (16.4, 53.4), VIA_PWR)
    # the pin only senses VBUS: 0.2 mm leaves room for the USB via and for the via of pad 25 (GNSS_WAKEUP) below
    r.track("VBUS", "F", 0.2, [(14.35, 53.4), (16.4, 53.4)])  # 0.05 mm north of the pad's centre
    r.track("VBUS", "F", PWR, [(16.4, 53.4), (17.05, 52.75)])
    # And on to the charger: L4 down to a via west of the BQ25180, L1 to its capacitor (C101) and ball A2.
    r.track("VBUS", "B", PWR, [(15.3, 58.5), (15.3, 61.5), (13.75, 63.05), (13.75, 63.25)])
    r.via("VBUS", (13.75, 63.25), VIA_PWR)
    r.track("VBUS", "F", PWR, [(13.75, 63.25), "C101.1"])
    r.track("VBUS", "F", 0.2, ["C101.1", (13.75, 64.8), "U101.A2"])


def charger_and_buck(r: Router) -> None:
    # BQ25180 (0.4 mm DSBGA): the north row escapes north (0.18 mm at 0.4 mm), D2 (GND) east to C103.
    r.track("SYS", "F", 0.18, ["U101.B2", (14.8, 63.3)])
    r.track("BAT", "F", 0.18, ["U101.C2", (15.2, 64.0), (15.45, 63.85)])
    r.track("BAT", "F", 0.3, [(15.45, 63.85), (17.3, 63.85), (17.3, 65.48), "C103.1"])
    r.track("GND", "F", 0.18, ["U101.D2", (16.3, 64.8)])
    # BAT from the cell (J101.1, bottom) to the charger: L4 east of the connector and a via next to C103.
    r.track("BAT", "F", PWR, [(17.3, 65.48), (17.3, 66.4)])
    r.via("BAT", (17.3, 66.4), VIA_PWR)
    r.track("BAT", "B", PWR, [(17.3, 66.4), (16.9, 66.5), (11.35, 66.5), (11.35, 67.2)])
    # Cell sense of the MAX17048 (U102 pins 2 and 3), Kelvin: its own trace from the pad of J101, carrying no
    # charge current. L4 along the bottom edge and up east of the buck-boost's resistors, one hop on L1 over the
    # VBUS run (y 58.5) east of the NAND, L4 again to a via east of U102, and L1 to the pins (from below, where
    # C309 used to be). C104 (its 1 uF) on L4 under U102. Along the edge at y 69.55 (0.325 mm from it), not 69.2:
    # with BAT above and below, the GND pin of J101 had no room for its via and was left on an island (26/11/2026).
    # It turns east at y 61.2, not 60.4, to leave room for the SYS via of R103 (pads_encerrados).
    r.track("BAT", "B", 0.25, [(11.35, 68.6), (11.35, 69.55), (18.65, 69.55), (19.0, 69.2), (19.0, 61.2), (19.7, 60.5),
                               (20.3, 59.9), (25.5, 59.9)])
    r.via("BAT", (25.5, 59.9))
    r.track("BAT", "F", 0.25, [(25.5, 59.9), (25.5, 57.75)])
    r.via("BAT", (25.5, 57.75))
    r.track("BAT", "B", 0.25, [(25.5, 57.75), (26.0, 57.25), (29.6, 57.25), (30.0, 56.85), (30.0, 52.0),
                               (30.35, 51.65), (30.35, 51.5)])
    r.via("BAT", (30.35, 51.5))
    r.track("BAT", "B", 0.25, [(30.0, 52.0), (28.52, 52.0), "C104.1"])
    r.track("BAT", "F", 0.2, [(30.35, 51.5), (28.75, 51.5), "U102.2"])
    r.track("BAT", "F", 0.2, [(29.25, 51.5), "U102.3"])
    # SYS from the charger's capacitor to the buck-boost: VIN (pin 10) through its input capacitor (C105) and EN
    # (pin 1).
    r.track("SYS", "F", PWR, ["C102.1", (14.875, 62.6), (17.075, 60.4), (21.4, 60.4)])
    r.track("SYS", "F", 0.3, [(21.15, 60.4), "U103.10"])
    r.track("SYS", "F", 0.3, [(21.4, 60.4), (21.625, 60.0)])
    r.track("SYS", "F", 0.25, [(18.85, 60.4), "U103.1"])
    # Switch nodes: pin to inductor pad, 0.95 mm each.
    r.track("BB_LX1", "F", 0.25, ["U103.9", (22.4, 61.5)])
    r.track("BB_LX2", "F", 0.25, ["U103.7", (22.4, 62.5)])
    # GND: pin 8 to the exposed pad; the output capacitor to the exposed pad on L1.
    r.track("GND", "F", 0.2, ["U103.8", (20.6, 62.0)])
    r.track("GND", "F", 0.3, ["C106.2", (19.35, 64.0), (19.8, 63.0)])
    # VOUT: pin 6 -> output capacitor -> under the inductor -> R108 (0 ohm to VREG).
    r.track("VREG_BB", "F", 0.3, ["U103.6", (21.15, 63.45), "C106.1"])
    r.track("VREG_BB", "F", 0.3, [(21.15, 63.45), (24.0, 63.45), (25.3, 62.15), "R108.1"])
    # VREG_LORA: C309 (moved next to it) to pin 1 of the LoRa load switch.
    r.track("VREG_LORA", "F", 0.3, ["C309.1", (27.9, 52.4), "U303.1"])
    # LORA_EN (pin 3) is boxed in by the NAND's pads, 0.25 mm to the west: out to the south to a via.
    r.track("LORA_EN", "F", 0.15, ["U303.3", (27.9, 54.5), (27.9, 55.0)])
    r.via("LORA_EN", (27.9, 55.0))


def pads_encerrados(r: Router) -> None:
    """GND pads that the maze router and the planes left without a connection, run after run (25/11/2026)."""
    # BMP581 (LGA, 0.5 mm): GND pad 3, in the bottom row between SCL and SDA, to GND pad 9 across the middle of the
    # package (no pads there).
    r.track("GND", "F", 0.15, ["U404.3", "U404.9"])
    # Load switch of the NAND (SC-70): GND pad 2 between pads 1 and 3, with the LoRa clearance 1.5 mm to the south and
    # BAT on L6 under the package, VBUS on L6 at y 58.5 and the test pads on L6 at y 56.4: south out of the pad,
    # east under pad 3, to a via between VBUS and the gap between TP101 and TP102.
    r.track("GND", "F", 0.2, ["U502.2", (29.2, 58.3), (31.65, 58.3), (32.35, 57.6)])
    r.via("GND", (32.35, 57.6))
    # ICM-42688-P (LGA, 0.5 mm): GND pads 6 and 7 sit in the bottom row between the VREG pads 5 and 8, and VREG
    # joined 5 and 8 around them, walling them in on L1 (26/11/2026): joined to each other and down to a via of
    # their own, which the GND pad of C403 below shares.
    r.track("GND", "F", 0.15, ["U402.6", "U402.7", (29.7, 42.75), (30.45, 43.5)])
    r.via("GND", (30.45, 43.5))
    r.track("GND", "B", 0.25, [(30.45, 43.5), "C403.2"])
    # TPS63900, CFG3 and CFG2 (pins 5 and 4, 0.5 mm WSON) to their pull-downs on the bottom side (R107 and R106, in a
    # column with 0.48 mm between pads): each one west on L1 to a via in the row that R105 left (see MOVES), and on
    # the bottom side CFG2 straight down to R106, CFG3 down between the pads of R106 to R107. CFG1 and SEL go to
    # the router.
    r.track("/power/BB_CFG3", "F", 0.15, ["U103.5", (18.0, 63.05)])
    r.via("/power/BB_CFG3", (18.0, 63.05))
    r.track("/power/BB_CFG3", "B", 0.15, [(18.0, 63.05), (17.85, 63.2), (17.85, 64.6), "R107.1"])
    r.track("/power/BB_CFG2", "F", 0.15, ["U103.4", (17.75, 62.5), (17.35, 62.75)])
    r.via("/power/BB_CFG2", (17.35, 62.75))
    r.track("/power/BB_CFG2", "B", 0.15, [(17.35, 62.75), "R106.1"])
    # The GND pad of R104 (SEL) right of those vias, boxed in by them and BAT on L6: down east of them to the GND
    # pad of R106, which has its via. The SYS pad of R103 above it: its own via east of it (where R105 now is,
    # west of it, the router put one), joined to the SYS track of L1 just south of it.
    r.track("GND", "B", 0.15, ["R104.2", (18.55, 61.95), (18.55, 63.6), "R106.2"])
    r.track("SYS", "B", 0.25, ["R103.2", (18.95, 60.3)])
    r.via("SYS", (18.95, 60.3))
    r.track("SYS", "F", 0.25, [(18.95, 60.3), (18.95, 60.4)])
    # Battery connector (J101): its GND pin between BAT and the cell sense of the MAX17048, a via just south of it.
    r.track("GND", "B", 0.3, ["J101.2", (12.6, 68.95)])
    r.via("GND", (12.6, 68.95))
    # Charger (U101): D2 (GND) and C103's GND pad sit inside the BAT loop of L1, and their piece of the fill gets out
    # only to the south, between D1 (BAT_NTC) and C103's BAT pad. Routed by the maze, BAT_NTC crossed that gap on
    # the diagonal and left them on an island (28/11/2026): straight down out of D1 to a via, west of the gap.
    r.track("/power/BAT_NTC", "F", 0.15, ["U101.D1", (15.6, 66.95), (15.3, 67.25)])
    r.via("/power/BAT_NTC", (15.3, 67.25))
    # eFuse (U602): its GND pad 8 and R606's GND pad, between EF_DVDT (pad 7 to C601) and EF_ILM, had their via
    # touching R606's pad; with the 0.15 mm from the pads, ``rescate`` put it on EF_DVDT's way (28/11/2026). A via
    # of their own between the two parts, between the ways of EF_DVDT (north-east) and EF_ILM (south).
    r.track("GND", "B", 0.2, ["U602.8", (39.55, 9.72), "R606.2"])
    r.via("GND", (39.55, 9.72))


# ---------------------------------------------------------------------------------------------------- BMD-340
def bmd340(r: Router) -> None:
    fp = r.fps["U301"]
    pads = {p.GetNumber(): p for p in fp.Pads()}
    pending = []  # pads that get a dogbone, once the fixed escapes are on the board
    skip = {"7", "13", "14", "65", "66", "67", "68"}  # not connected, crystal, VREG, VBUS, USB: routed apart
    for num, p in sorted(pads.items(), key=lambda kv: int(kv[0])):
        if num in skip:
            continue
        net = p.GetNetname()
        x, y = pcbnew.ToMM(p.GetPosition().x) - ORIGIN[0], pcbnew.ToMM(p.GetPosition().y) - ORIGIN[1]
        if abs(y - 50.7) < 0.01:  # outer top row: L1 to a via above the module
            r.track(net, "F", 0.15, [(x, y), (x, 49.8)])
            r.via(net, (x, 49.8))
        elif abs(y - 51.6) < 0.01:  # second top row: between two outer pads, to a second row of vias 1.5 mm further
            r.track(net, "F", 0.15, [(x, y), (x, 48.3)])  # north (two staggered rows 0.8 mm apart close the way)
            r.via(net, (x, 48.3))
        elif net == "GND" and abs(y - 59.5) < 0.01:
            pass  # outer bottom row: the GND plane of L1 reaches them from the south
        elif net == "GND" and abs(y - 58.6) < 0.01:  # second bottom row: between two outer pads to the plane
            r.track(net, "F", 0.2, [(x, y), (x, 60.2)])
        elif num == "29":  # GND, next to pad 30 (GND, outer top row, with its via)
            r.track(net, "F", 0.2, [(x, y), r.pad("U301", "30")])
        else:  # everything else: a short track on L1 to a via next to the pad (dogbone), never in it
            pending.append((net, (x, y)))
    # VREG (pad 65) to its 100 nF and 4.7 uF on L1 (both turned with VREG to this side), and XL1 straight on L1 to
    # the crystal, its load capacitor below it: on the board before the dogbones, which go around them.
    r.track("VREG", "F", 0.2, ["U301.65", (16.6, 54.55), "C302.1"])  # between the vias of pads 25 and 23
    r.track("VREG", "F", 0.3, ["C302.1", "C301.1"])
    r.track("XL1", "F", 0.15, ["U301.13", (10.8, 60.6), "Y301.1"])
    r.track("XL1", "F", 0.15, ["Y301.1", (10.8, 62.45), (9.4, 62.45), "C304.1"])
    # XL2 (second row) on L1 too, down between the outer pads 13 and 15 to the crystal: no via (until 27/11/2026,
    # through a via in its pad and 2 mm on L3).
    r.track("XL2", "F", 0.15, ["U301.14", (11.8, 60.25), (12.2, 60.65), "Y301.2"])
    r.track("XL2", "F", 0.15, ["Y301.2", (12.2, 62.45), (13.6, 62.45), "C305.1"])

    # The most boxed-in pads first (most neighbours within 1.2 mm): they have the fewest spots. One pad's via can
    # take the only spot of another's, so when some pad finds none, every dogbone comes out and they go again with
    # those pads first, until all fit.
    def neighbours(xy):
        return sum(1 for q in fp.Pads() if 0.01 < math.dist(xy, r.pad("U301", q.GetNumber())) < 1.2)

    order = sorted(pending, key=lambda item: -neighbours(item[1]))
    first = {xy: east_block_spot(xy) for _, xy in pending}
    best = None
    for attempt in range(DOGBONE_TRIES + 1):
        if attempt == DOGBONE_TRIES:  # none fit them all: again in the order that left the fewest
            order = best[1]
        bones, failed = {}, []
        free = Free(r.board, clear=0.1)
        for net, xy in order:
            if not place_dogbone(r, free, net, xy, bones, first.get(xy)):
                failed.append((net, xy))
        if not failed or attempt == DOGBONE_TRIES:
            break
        if best is None or len(failed) < best[0]:
            best = (len(failed), list(order))
        for xy in list(bones):
            lift_dogbone(r, bones, xy)
        order = failed + [p for p in order if p not in failed]
    # Local repair of the pads still without a spot: lift a neighbour's dogbone (nearest first), place the pad, put the
    # neighbour back; when the neighbour no longer fits, both go back as they were.
    for net, xy in list(failed):
        for other in sorted((q for q in bones if 0.01 < math.dist(q, xy) < 2.5), key=lambda q: math.dist(q, xy)):
            onet = bones[other][0]
            lift_dogbone(r, bones, other)
            if place_dogbone(r, Free(r.board, clear=0.1), net, xy, bones, first.get(xy)):
                if place_dogbone(r, Free(r.board, clear=0.1), onet, other, bones, first.get(other)):
                    failed.remove((net, xy))
                    break
                lift_dogbone(r, bones, xy)
            place_dogbone(r, Free(r.board, clear=0.1), onet, other, bones, first.get(other))
    for net, xy in list(failed):  # a neighbour put back elsewhere can leave the way open
        if place_dogbone(r, Free(r.board, clear=0.1), net, xy, bones, first.get(xy)):
            failed.remove((net, xy))
    for net, xy in failed:
        print(f"BMD-340: {net} (pad en {xy[0]:.2f}; {xy[1]:.2f}) sin vía al lado en línea recta: queda para resto")


# The four staggered columns of the east block of the BMD-340 (x of each column): every pad goes straight out to a
# column of vias on its side, the inner columns' vias one row further out, so each track passes between the pads
# and between the vias of the column before it. West (inside the module, empty): x 11.65 and 12.55, and x 13.45
# where x 11.65 has no pad; east: x 14.35, and x 13.45 in front of the pads of x 11.65.
EAST_BLOCK = {11.65: 10.9, 12.55: 10.15, 13.45: 10.9, 14.35: 15.1}
EAST_BLOCK_EAST = 15.85  # x 13.45 between y 53.5 and 56.5 (x 11.65 closes the way west)


def east_block_spot(xy: tuple) -> tuple | None:
    x, y = xy
    col = next((c for c in EAST_BLOCK if abs(x - c) < 0.01), None)
    if col is None or not 52.0 < y < 58.5:
        return None
    if col == 13.45 and 53.5 < y < 56.5:
        return (EAST_BLOCK_EAST, y)
    return (EAST_BLOCK[col], y)


def place_dogbone(r: Router, free: "Free", net: str, xy: tuple, bones: dict, first: tuple | None = None) -> bool:
    """``dogbone`` that records what it adds in ``bones`` (pad -> (net, items, via)), so it can come out again."""
    n0 = len(r.added)
    v = dogbone(r, free, net, xy, first=first)
    if v is None:
        return False
    bones[xy] = (net, r.added[n0:], v)
    return True


def lift_dogbone(r: Router, bones: dict, xy: tuple) -> None:
    for item in bones.pop(xy)[1]:
        r.added.remove(item)
        r.board.Delete(item)


def dogbone(r: Router, free: "Free", net: str, pad: tuple, width: float = 0.12, first: tuple | None = None) \
        -> tuple | None:
    """A via of ``net`` next to the BMD-340 pad at ``pad`` (document coordinates) with a short L1 track to it: the
    nearest spot where both fit, preferring the inside of the module (empty: its pads are on the edges). Since
    27/11/2026, instead of a via in the pad (resin-filled and capped, about US$ 5 a board at 100)."""
    fp = r.fps["U301"]
    cx = sum(pcbnew.ToMM(p.GetPosition().x) for p in fp.Pads()) / len(fp.Pads()) - ORIGIN[0]
    cy = sum(pcbnew.ToMM(p.GetPosition().y) for p in fp.Pads()) / len(fp.Pads()) - ORIGIN[1]
    inward = math.atan2(cy - pad[1], cx - pad[0])
    tries = []
    for k in range(72):
        a = 2 * math.pi * k / 72
        off = abs((a - inward + math.pi) % (2 * math.pi) - math.pi)
        for step in range(60):
            d = 0.55 + 0.05 * step
            tries.append((d + 0.4 * off, d, a))
    spots = [(pad[0] + d * math.cos(a), pad[1] + d * math.sin(a)) for _, d, a in sorted(tries)]
    for x, y in ([first] if first else []) + spots:
        v = pcbnew.PCB_VIA(r.board)
        v.SetPosition(pt(x, y))
        v.SetWidth(mm(VIA_SIG[0]))
        v.SetDrill(mm(VIA_SIG[1]))
        v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        v.SetNet(r.net(net))
        tr = pcbnew.PCB_TRACK(r.board)
        tr.SetStart(pt(*pad))
        tr.SetEnd(pt(x, y))
        tr.SetWidth(mm(width))
        tr.SetLayer(pcbnew.F_Cu)
        tr.SetNet(r.net(net))
        if free.fits(v, ALL_CU) and free.fits(tr, [pcbnew.F_Cu]):
            x, y = round(x, 3), round(y, 3)
            r.track(net, "F", width, [pad, (x, y)])
            free.add(r.added[-1])
            r.via(net, (x, y))
            free.add(r.added[-1])
            return (x, y)
    # No straight spot (the middle columns of the east block, four staggered columns): left to the caller.
    return None


def criticas(path: Path, force: bool) -> int:
    board = pcbnew.LoadBoard(str(path))
    if len(board.GetTracks()) and not force:
        raise SystemExit("La placa ya tiene pistas: criticas es de una sola vez (--forzar en una copia)")
    for line in apply_moves(board):
        print("movida", line)
    r = Router(board)
    lengths = {}
    lengths.update(gnss_rf(r))
    lengths.update(lora_rf(r))
    lengths.update(usb(r))
    detect(r)
    vbus(r)
    charger_and_buck(r)
    pads_encerrados(r)
    bmd340(r)
    for k, v in lengths.items():
        print(f"largo {k}: {v:.2f} mm")
    sys.path.insert(0, str(TOOLS))
    import ubicar  # noqa: E402  (the reference placer of ubicar.py, for the moved parts)
    hidden = ubicar.place_references(board, set(MOVES) | {"U103", "R103"})  # U103's sat where C102 went, R103's where R105
    print(f"referencias de las partes movidas reubicadas ({hidden} ocultas)")
    fill(board)
    save(board, path)
    print(f"{sum(1 for i in r.added if i.Type() == pcbnew.PCB_TRACE_T)} pistas y "
          f"{sum(1 for i in r.added if i.Type() == pcbnew.PCB_VIA_T)} vías bloqueadas: {path}")
    return 0


def fill(board) -> None:
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())


# ------------------------------------------------------------------------------------------------- Freerouting
# Freerouting reads the net classes (width, clearance, via) and the keep-outs of the DSN, not pod-v0.kicad_dru.
# KiCad exports every rule area as a full keep-out, whatever it allows, so the DSN is rewritten here to say what the
# custom rules say. Rectangles in DSN units (um), as (x0, y0, x1, y1) in KiCad coordinates (the DSN negates y).
GNSS_ANTENA = (110000, 102000, 140000, 132000)  # L1: only GND and RF, and only GND vias -> no routing on L1, no vias
LORA_ANTENA = (126700, 159050, 142700, 170000)  # only the LoRa feed (routed) on L1: nothing else on any layer
# Under the 32.768 kHz crystal (GNSS_SENSITIVE): no tracks on L3 (In2), the first signal layer under the L2 plane.
CRISTAL = (108500, 160800, 114500, 162900)
FR_VIA_DEFAULT = "Via[0-3]_500:200_um"
FR_WIDTHS = {"kicad_default": 200, "POWER_DOCK": 300}  # POWER_DOCK: only the low-current branches are left


def rect(layer: str, box: tuple, kind: str = "keepout") -> str:
    x0, y0, x1, y1 = box
    return f'    ({kind} "" (polygon {layer} 0  {x0} -{y0}  {x1} -{y0}  {x1} -{y1}  {x0} -{y1}  {x0} -{y0}))\n'


def dsn_for_freerouting(text: str) -> str:
    layers = re.findall(r"\(layer (\S+)\n\s+\(type", text)
    top, inner2, bottom = layers[0], layers[2], layers[-1]
    gnss = f"{GNSS_ANTENA[0]} -{GNSS_ANTENA[1]}  {GNSS_ANTENA[2]} -{GNSS_ANTENA[1]}"
    lora = f"{LORA_ANTENA[0]} -{LORA_ANTENA[1]}  {LORA_ANTENA[2]} -{LORA_ANTENA[1]}"
    out, skip = [], False
    for line in text.splitlines(keepends=True):
        # the exported keep-outs of GNSS_ANTENA and LORA_ANTENA (all layers, whatever they allow) are replaced
        # below; each one takes two lines (the polygon closes on the next one). BLE_ANTENA forbids everything: as is.
        if skip:
            skip = False
            continue
        if line.lstrip().startswith(("(keepout", "(via_keepout")) and (gnss in line or lora in line):
            skip = not line.rstrip().endswith("))")
            continue
        out.append(line)
    text = "".join(out)
    # GNSS_ANTENA: nothing but GND and RF on L1, vias included (a keep-out on L1 stops the vias too); the inner
    # layers and L6 are free under the patch. LORA_ANTENA: only its feed (routed and locked) on any layer.
    extra = rect(top, GNSS_ANTENA)
    for layer in layers:
        extra += rect(layer, LORA_ANTENA)
    extra += rect(inner2, CRISTAL, "wire_keepout")
    text = text.replace("    (via ", extra + "    (via ", 1)

    def cls(m):
        block, name = m.group(0), m.group(1)
        if name == "kicad_default":  # the small via (0.5/0.2) for signals
            block = re.sub(r'\(use_via "[^"]+"\)', f'(use_via "{FR_VIA_DEFAULT}")', block)
        if name in FR_WIDTHS:
            block = re.sub(r"\(width \d+(\.\d+)?\)", f"(width {FR_WIDTHS[name]})", block)
        if name == "POWER_DOCK":  # 1 A nets: 1.5 mm on inner layers (custom rule), so their branches stay outside
            block = block.replace("(circuit\n", f"(circuit\n        (use_layer {top} {bottom})\n", 1)
        # 10 um of margin on every clearance: the session rounds to 0.1 um
        return re.sub(r"\(clearance (\d+)(\.\d+)?\)", lambda c: f"(clearance {int(c.group(1)) + 10})", block)
    text = re.sub(r"\(class (\S+) .*?\n    \)\n", cls, text, flags=re.S)
    # GND is left to the planes and to `planos` (a via next to every GND pad the planes do not reach): without its
    # pins, Freerouting takes the GND pads as obstacles and spends its passes on the signals. The GND plane of L2
    # stays, so Freerouting keeps L2 as a power layer (no tracks) that vias cross.
    text, n = re.subn(r"(\n    \(net GND\n      )\(pins .*?\)(\n    \))", r"\1(pins)\2", text, count=1, flags=re.S)
    assert n == 1, "no encontré la red GND en el DSN"
    return text


def edge_keepouts(board, layers: list) -> str:
    """Keep-outs 0.45 mm wide along the board outline (copper 0.3 mm from the edge, PCBWay): Freerouting does not
    take the edge clearance of the board setup."""
    outline = pcbnew.SHAPE_POLY_SET()
    board.GetBoardPolygonOutlines(outline, False)
    chain = outline.Outline(0)
    pts = [(chain.CPoint(i).x / 1000, chain.CPoint(i).y / 1000) for i in range(chain.PointCount())]
    out = ""
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        length = math.dist((x0, y0), (x1, y1))
        if length < 1:
            continue
        nx, ny = -(y1 - y0) / length * 450, (x1 - x0) / length * 450
        quad = [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny), (x0 + nx, y0 + ny)]
        xy = "  ".join(f"{x:.1f} {-y:.1f}" for x, y in quad)
        for layer in layers:
            out += f'    (keepout "" (polygon {layer} 0  {xy}))\n'
    return out


def dsn(path: Path, out: Path) -> int:
    board = pcbnew.LoadBoard(str(path))
    if not pcbnew.ExportSpecctraDSN(board, str(out)):
        raise SystemExit("ExportSpecctraDSN falló")
    text = dsn_for_freerouting(out.read_text(encoding="utf-8"))
    layers = re.findall(r"\(layer (\S+)\n\s+\(type", text)
    signal = [name for name, kind in re.findall(r"\(layer (\S+)\n\s+\(type (\w+)", text) if kind == "signal"]
    text = text.replace("    (via ", edge_keepouts(board, signal) + "    (via ", 1)
    out.write_text(text, encoding="utf-8")
    print(f"DSN para Freerouting: {out}")
    return 0


def ses(path: Path, session: Path) -> int:
    board = pcbnew.LoadBoard(str(path))
    locked = sum(1 for t in board.GetTracks() if t.IsLocked())
    if not pcbnew.ImportSpecctraSES(board, str(session)):
        raise SystemExit("ImportSpecctraSES falló")
    # KiCad keeps the locked tracks and adds what the session brings, the fixed wires included: drop the copies.
    seen, dupes = set(), []
    for t in sorted(board.GetTracks(), key=lambda t: not t.IsLocked()):
        # the session rounds to 0.1 um: compare to the micrometre
        key = (t.Type(), t.GetNetCode(), t.GetLayer() if t.Type() != pcbnew.PCB_VIA_T else -1,
               tuple(sorted([(round(t.GetStart().x, -3), round(t.GetStart().y, -3)),
                             (round(t.GetEnd().x, -3), round(t.GetEnd().y, -3))])), round(t.GetWidth(pcbnew.F_Cu) if t.Type() == pcbnew.PCB_VIA_T else t.GetWidth(), -3))
        if key in seen:
            dupes.append(t)
        seen.add(key)
    # Nothing of Freerouting on the nets routed by `criticas` (it sometimes closes a junction of its own on them).
    scripted = {"RF_50", "USB_90D", "SW_NODE"}
    dupes += [t for t in board.GetTracks() if not t.IsLocked() and t.GetNetClassName() in scripted and t not in dupes]
    for t in dupes:
        board.Delete(t)
    fill(board)
    save(board, path)
    print(f"sesión importada: {len(board.GetTracks())} pistas y vías ({locked} bloqueadas, {len(dupes)} copias quitadas)")
    return 0


# ----------------------------------------------------------------------------------------------------- planes
STITCH = (0.6, 0.3)  # stitching vias, GND
STITCH_PITCH = 2.5  # grid of the stitching over the whole board (mm)
EDGE_PITCH = 1.8  # along the board edge
RF_PITCH = 1.5  # along both sides of every RF_50 track
DOGBONE_TRIES = 30  # rounds of the BMD-340 dogbones, the pads left without a spot first
VIA_PAD_GAP = 0.15  # via hole to the copper of any SMD pad: the hole stays under solder mask (no via-in-pad)
CLEAR = 0.25  # copper of another net (the GND-to-RF coplanar gap is 0.20)


class Free:
    """Answers "does this via or short track (GND, or VREG) fit here?" against the copper of every other net, the
    keep-outs (rule areas and footprint keep-outs: anything that forbids something) and the board edge."""

    def __init__(self, board, clear: float = None):
        self.clear = CLEAR if clear is None else clear
        self.gnd = board.FindNet("GND").GetNetCode()
        self.items = [pad for fp in board.GetFootprints() for pad in fp.Pads()] + list(board.GetTracks())
        self.areas = [z for z in board.Zones() if z.GetIsRuleArea()] + \
            [z for fp in board.GetFootprints() for z in fp.Zones() if z.GetIsRuleArea()]
        self.areas = [z for z in self.areas if z.GetDoNotAllowVias() or z.GetDoNotAllowTracks()
                      or z.GetDoNotAllowZoneFills() or z.GetDoNotAllowPads()]
        self.edges = [d.GetEffectiveShape() for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
        self.outline = pcbnew.SHAPE_POLY_SET()
        board.GetBoardPolygonOutlines(self.outline, False)
        # the escape of the BMD-340: GNSS_SENSITIVE copper touching its courtyard keeps 0.15 mm, not 0.3 (rule
        # "GNSS_SENSITIVE: escape del BMD-340" of pod-v0.kicad_dru)
        u301 = board.FindFootprintByReference("U301")
        self.u301 = u301.GetCourtyard(pcbnew.F_Cu).BBox() if u301 else None
        self.grid = {}
        for i, it in enumerate(self.items):
            self.index(i, it)

    def own_clearance(self, item, lay) -> int:
        if item.GetNetClassName() == "GNSS_SENSITIVE" and self.u301 and self.u301.Intersects(item.GetBoundingBox()):
            return mm(0.15)
        return item.GetOwnClearance(lay)

    def index(self, i, item):
        box = item.GetBoundingBox()
        size = mm(2)
        for gx in range(box.GetLeft() // size, box.GetRight() // size + 1):
            for gy in range(box.GetTop() // size, box.GetBottom() // size + 1):
                self.grid.setdefault((gx, gy), []).append(i)

    def near(self, box):
        size, seen = mm(2), set()
        for gx in range(box.GetLeft() // size, box.GetRight() // size + 1):
            for gy in range(box.GetTop() // size, box.GetBottom() // size + 1):
                for i in self.grid.get((gx, gy), ()):
                    if i not in seen:
                        seen.add(i)
                        yield self.items[i]

    def add(self, item):
        self.items.append(item)
        self.index(len(self.items) - 1, item)

    def fits(self, item, layers, min_gnd_via: float = 0.0) -> bool:
        via = item.Type() == pcbnew.PCB_VIA_T
        for p in ([item.GetPosition()] if via else [item.GetStart(), item.GetEnd()]):
            if not self.outline.Contains(p):
                return False
        mine = {lay: item.GetEffectiveShape(lay) for lay in layers}
        if any(e.Collide(mine[layers[0]], mm(0.35)) for e in self.edges):
            return False
        for area in self.areas:
            for lay in layers:
                if area.IsOnLayer(lay) and area.Outline().Collide(mine[lay], 0):
                    return False
        box = item.GetBoundingBox()
        box.Inflate(mm(1.6))
        for other in self.near(box):
            if other is item:
                continue
            gnd = other.GetNetCode() == item.GetNetCode()  # same net (GND, or VREG for its vias)
            # never a via in or touching an SMD pad, of any net (no resin-filled via-in-pad: 27/11/2026)
            if via and other.Type() == pcbnew.PCB_PAD_T and \
                    other.GetAttribute() in (pcbnew.PAD_ATTRIB_SMD, pcbnew.PAD_ATTRIB_CONN):
                lay = pcbnew.B_Cu if other.IsOnLayer(pcbnew.B_Cu) else pcbnew.F_Cu
                if other.GetEffectiveShape(lay).Collide(item.GetEffectiveHoleShape(), mm(VIA_PAD_GAP)):
                    return False
            if via and other.Type() in (pcbnew.PCB_VIA_T, pcbnew.PCB_PAD_T) and other.HasHole():
                hole = other.GetEffectiveHoleShape()
                if hole.Collide(item.GetEffectiveHoleShape(), mm(0.25 if gnd else 0.4)):
                    return False
            if gnd:
                if via and min_gnd_via and other.Type() == pcbnew.PCB_VIA_T and \
                        other.GetEffectiveShape(pcbnew.F_Cu).Collide(mine[layers[0]], mm(min_gnd_via)):
                    return False
                continue
            for lay in layers:
                if not other.IsOnLayer(lay):
                    continue
                # the other item's own clearance (net class, local), except RF_50: against GND it is the
                # coplanar gap of the custom rules
                gap = mm(self.clear) if other.GetNetClassName() == "RF_50" and item.GetNetname() == "GND" \
                    else max(mm(self.clear), self.own_clearance(other, lay) + mm(0.02))
                if other.GetEffectiveShape(lay).Collide(mine[lay], gap):
                    return False
        return True


def stitch_via(board, free: Free, x: float, y: float, min_gnd_via: float, size: tuple = STITCH):
    v = pcbnew.PCB_VIA(board)
    v.SetPosition(pt(x, y))
    v.SetWidth(mm(size[0]))
    v.SetDrill(mm(size[1]))
    v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
    v.SetNet(board.FindNet("GND"))
    if free.fits(v, ALL_CU, min_gnd_via):
        board.Add(v)
        free.add(v)
        return v
    return None


def unconnected_gnd_pads(path: Path, net: str = "GND") -> list[tuple[str, str]]:
    """(ref, pad) of every pad of ``net`` (GND unless said) that the DRC of ``path`` still reports as unconnected."""
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "drc.json"
        subprocess.run(["kicad-cli", "pcb", "drc", "--format", "json", "--severity-all", "--output", str(report),
                        str(path)], check=True, capture_output=True)
        data = json.loads(report.read_text(encoding="utf-8"))
    found = []
    for item in data["unconnected_items"]:
        for it in item["items"]:
            m = re.match(r"(?:PTH )?[Pp]ad (\S+) \[" + re.escape(net) + r"\] of (\S+)", it["description"])
            if m and (m.group(2), m.group(1)) not in found:
                found.append((m.group(2), m.group(1)))
    return found


def stitch_fragments(board, free: Free) -> tuple[int, int]:
    """Every piece of the GND fill of L1, L3, L4 and L6 gets at least one via to L2: a piece that only reaches a pad
    (walled in by tracks) would stay apart from the rest of the ground. Returns (vias added, pieces left)."""
    gnd = board.FindNet("GND").GetNetCode()
    vias = [t.GetPosition() for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T and t.GetNetCode() == gnd]
    vias += [p.GetPosition() for fp in board.GetFootprints() for p in fp.Pads()
             if p.GetNetCode() == gnd and p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH]
    added = left = 0
    for z in list(board.Zones()):
        if z.GetIsRuleArea() or z.GetNetCode() != gnd or z.GetLayer() in (pcbnew.In1_Cu, pcbnew.In4_Cu):
            continue
        polys = z.GetFilledPolysList(z.GetLayer())
        for i in range(polys.OutlineCount()):
            chain = polys.Outline(i)
            if any(polys.Contains(v, i) for v in vias):  # on the copper of this piece, not over one of its holes
                continue
            box = chain.BBox()
            done = False
            step = mm(0.15)
            for gx in range(box.GetLeft(), box.GetRight(), step):
                for gy in range(box.GetTop(), box.GetBottom(), step):
                    p = pcbnew.VECTOR2I(gx, gy)
                    if not chain.PointInside(p) or not polys.Contains(p):
                        continue
                    v = stitch_via(board, free, pcbnew.ToMM(gx) - ORIGIN[0], pcbnew.ToMM(gy) - ORIGIN[1], 0.3, VIA_SIG)
                    if v:
                        vias.append(v.GetPosition())
                        added += 1
                        done = True
                        break
                if done:
                    break
            if not done:  # a sliver with no room for a via: a via next to one of the GND pads it touches
                layer = z.GetLayer()
                for fp in board.GetFootprints():
                    for pad in fp.Pads():
                        if pad.GetNetCode() == gnd and pad.IsOnLayer(layer) and chain.PointInside(pad.GetPosition()):
                            if gnd_via_next_to(board, free, fp.GetReference(), pad.GetNumber()):
                                added += 1
                                done = True
                                break
                    if done:
                        break
            left += not done
    return added, left


def gnd_via_next_to(board, free: Free, ref: str, num: str, net: str = "GND", where=None) -> bool:
    """A via of ``net`` (GND unless said) next to a pad that the planes do not reach, with a short track on the
    pad's layer; ``where(x, y)`` limits where the via can go (inside its plane)."""
    fp = board.FindFootprintByReference(ref)
    pads = [p for p in fp.Pads() if p.GetNumber() == num]
    for pad in pads:
        layer = pcbnew.F_Cu if pad.IsOnLayer(pcbnew.F_Cu) else pcbnew.B_Cu
        c = pad.GetPosition()
        reach = max(pad.GetBoundingBox().GetWidth(), pad.GetBoundingBox().GetHeight()) / 2e6
        for dist in [reach + 0.45 + 0.15 * k for k in range(16)]:
            for k in range(16):
                a = 2 * math.pi * k / 16
                x, y = pcbnew.ToMM(c.x) - ORIGIN[0] + dist * math.cos(a), pcbnew.ToMM(c.y) - ORIGIN[1] + dist * math.sin(a)
                if where and not where(x, y):
                    continue
                v = pcbnew.PCB_VIA(board)
                v.SetPosition(pt(x, y))
                v.SetWidth(mm(VIA_SIG[0]))
                v.SetDrill(mm(VIA_SIG[1]))
                v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                v.SetNet(board.FindNet(net))
                t = pcbnew.PCB_TRACK(board)
                t.SetStart(c)
                t.SetEnd(v.GetPosition())
                t.SetWidth(mm(0.25))
                t.SetLayer(layer)
                t.SetNet(board.FindNet(net))
                if free.fits(v, ALL_CU) and free.fits(t, [layer]):
                    v.SetLocked(True)  # the router leaves it alone (podar only bridges it if it ends up dangling)
                    t.SetLocked(True)
                    board.Add(v)
                    board.Add(t)
                    free.add(v)
                    free.add(t)
                    return True
    return False


def zone(board, net: str, layer: int, pts: list, name: str, priority: int) -> None:
    z = pcbnew.ZONE(board)
    z.SetLayer(layer)
    z.SetNet(board.FindNet(net))
    z.SetZoneName(name)
    z.SetAssignedPriority(priority)
    z.SetLocalClearance(mm(0.2))
    z.SetMinThickness(mm(0.2))
    z.SetPadConnection(pcbnew.ZONE_CONNECTION_THT_THERMAL)  # SMD pads solid, through-hole with spokes
    z.SetThermalReliefGap(mm(0.25))
    z.SetThermalReliefSpokeWidth(mm(0.35))
    z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
    outline = z.Outline()
    outline.NewOutline()
    for x, y in pts:
        outline.Append(mm(x + ORIGIN[0]), mm(y + ORIGIN[1]))
    board.Add(z)


BOARD_BOX = [(0, 0), (50, 0), (50, 70), (0, 70)]

# 6 layers since 23/11/2026 (ADR 0105, "Registro de decisiones"): the board did not close in 4. Symmetric stackup,
# with L1 and L6 0.2 mm from their GND plane (L2 and L5), the same prepreg as before, so the CPWG of RF_50 (0.33 /
# 0.20 mm) and the USB pair (0.25 / 0.15 mm) keep their geometry; not verified against PCBWay.
COPPER_LAYERS = """\t\t(0 "F.Cu" signal)
\t\t(4 "In1.Cu" power "In1.Cu.GND")
\t\t(6 "In2.Cu" signal "In2.Cu.SIG")
\t\t(8 "In3.Cu" signal "In3.Cu.SIG")
\t\t(10 "In4.Cu" power "In4.Cu.GND")
\t\t(2 "B.Cu" signal)
"""
STACKUP = [("F.Cu", 0.035), ("prepreg", 0.2, "FR4 7628", 4.4), ("In1.Cu", 0.0175), ("core", 0.3, "FR4", 4.6),
           ("In2.Cu", 0.0175), ("prepreg", 0.46, "FR4 7628", 4.4), ("In3.Cu", 0.0175), ("core", 0.3, "FR4", 4.6),
           ("In4.Cu", 0.0175), ("prepreg", 0.2, "FR4 7628", 4.4), ("B.Cu", 0.035)]


def stackup_text() -> str:
    out, k = [], 0
    for item in STACKUP:
        if len(item) == 2:
            out.append(f'\t\t\t(layer "{item[0]}"\n\t\t\t\t(type "copper")\n\t\t\t\t(thickness {item[1]})\n\t\t\t)')
        else:
            k += 1
            kind, thick, material, er = item
            out.append(f'\t\t\t(layer "dielectric {k}"\n\t\t\t\t(type "{kind}")\n\t\t\t\t(thickness {thick})\n'
                       f'\t\t\t\t(material "{material}")\n\t\t\t\t(epsilon_r {er})\n\t\t\t\t(loss_tangent 0.02)\n\t\t\t)')
    return "\n".join(out) + "\n"


def seis_capas(path: Path) -> int:
    """The 4-layer board of 22/11/2026 to 6 layers (L1 signals and RF, L2 GND, L3 signals, L4 power, L5 GND, L6
    signals): the stackup, the rule areas and footprint keep-outs over the new layers, a GND plane on L5 like the one
    of L2, and out goes what the old stackup needed: the L3_GND strips (L6 now has L5 under it, all GND), the planes
    of L1, L3 and L4 and every track and via, so the routing starts again from ``criticas`` (the parts stay where
    they are)."""
    text = path.read_text(encoding="utf-8")
    if '"In3.Cu"' in text:
        raise SystemExit("La placa ya es de 6 capas")
    text = re.sub(r'\t\t\(0 "F\.Cu" signal\)\n\t\t\(4 "In1\.Cu".*?\n\t\t\(6 "In2\.Cu".*?\n\t\t\(2 "B\.Cu" signal\)\n',
                  lambda m: COPPER_LAYERS, text, count=1)
    text = re.sub(r'\t\t\t\(layer "F\.Cu"\n\t\t\t\t\(type "copper"\).*?\t\t\t\(layer "B\.Cu"\n\t\t\t\t\(type "copper"\)\n'
                  r'\t\t\t\t\(thickness [0-9.]+\)\n\t\t\t\)\n', lambda m: stackup_text(), text, count=1, flags=re.S)
    text = text.replace('(layers "F.Cu" "B.Cu" "In1.Cu" "In2.Cu")', '(layers "F.Cu" "B.Cu" "In1.Cu" "In2.Cu" "In3.Cu" "In4.Cu")')
    text = text.replace('(layers "F.Cu" "In1.Cu" "In2.Cu")', '(layers "F.Cu" "In1.Cu" "In2.Cu" "In3.Cu" "In4.Cu")')
    path.write_text(text, encoding="utf-8")
    board = pcbnew.LoadBoard(str(path))
    if board.GetCopperLayerCount() != 6:
        raise SystemExit(f"La placa quedó con {board.GetCopperLayerCount()} capas de cobre")
    gone = {"pistas": 0, "zonas": []}
    for t in list(board.GetTracks()):  # all of it: ``criticas`` runs again (``podar`` took the escape vias of the
        board.Delete(t)  # BMD-340 pads whose nets were left unrouted, and without them those pads have no way out)
        gone["pistas"] += 1
    for z in list(board.Zones()):
        if z.GetZoneName() in ("L3_GND", "L1_GND", "L3_GND_PLANO", "L3_VREG", "L4_GND"):
            gone["zonas"].append(z.GetZoneName())
            board.Delete(z)
    l2 = next(z for z in board.Zones() if z.GetZoneName() == "L2_GND")
    l5 = pcbnew.ZONE(l2)
    l5.SetLayer(pcbnew.In4_Cu)
    l5.SetZoneName("L5_GND")
    board.Add(l5)
    fill(board)
    save(board, path)
    print(f"6 capas: sacadas {gone['pistas']} pistas y vías y las zonas {gone['zonas']}; L5_GND agregada")
    return 0


def out_of_gnss(x: float, y: float) -> bool:
    """Out of GNSS_ANTENA (x 10-40, y 2-32, plus the via's radius): inside it only GND vias (custom rule)."""
    return not (9.6 < x < 40.4 and 1.6 < y < 32.4)


# GND pads that get no via of their own but a short locked track east, into the GND fill of L1 in GNSS_ANTENA: their
# vias (with their tracks) walled in the east pads of R311 and R312 (LED_DG, LED_DB) between the antenna and the
# column, and without anything the router ran LED_DG and LED_DB between them and the fill (25/11/2026). The stubs
# leave the gaps between the resistors free, where LED_DG and LED_DB go west.
SIN_VIA_GND = {"R316.2", "R317.2", "R318.2"}
# GND pads that get their own via even with another GND via within 1 mm: that via was on a piece of the fill that
# the tracks around the pad cut off (C102, next to the charger, 25/11/2026).
CON_VIA_GND = {"C102.2"}
STUB_X = 10.3  # end of those tracks: inside GNSS_ANTENA (x from 10.0)


def gnd_stub_east(board, ref: str, num: str) -> bool:
    pad = [p for p in board.FindFootprintByReference(ref).Pads() if p.GetNumber() == num][0]
    c = pad.GetPosition()
    t = pcbnew.PCB_TRACK(board)
    t.SetStart(c)
    t.SetEnd(pt(STUB_X, pcbnew.ToMM(c.y) - ORIGIN[1]))
    t.SetWidth(mm(0.25))
    t.SetLayer(pcbnew.F_Cu)
    t.SetNet(board.FindNet("GND"))
    t.SetLocked(True)
    board.Add(t)
    return True


def abanico(path: Path) -> int:
    """Before ``resto``: a GND via next to every SMD GND pad, down to the planes of L2 and L5, while there is still
    room around the pads (after the maze router there was none for most of them). VREG is routed as tracks: L4 is a
    signal layer with GND fill since 26/11/2026."""
    board = pcbnew.LoadBoard(str(path))
    free = Free(board)
    # GND: every SMD pad gets its own via to the planes of L2 and L5 (shortest return path, and the planes of L1 and
    # L6 alone left pieces walled in by tracks), unless a GND via or plated hole is already within 1 mm.
    gnd = board.FindNet("GND").GetNetCode()
    holes = [t.GetPosition() for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T and t.GetNetCode() == gnd]
    holes += [p.GetPosition() for fp in board.GetFootprints() for p in fp.Pads()
              if p.GetNetCode() == gnd and p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH]
    vias_gnd, sin_gnd = 0, []
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            if pad.GetNetCode() != gnd or pad.GetAttribute() != pcbnew.PAD_ATTRIB_SMD:
                continue
            c = pad.GetPosition()
            if f"{fp.GetReference()}.{pad.GetNumber()}" not in CON_VIA_GND and \
                    any(math.hypot(h.x - c.x, h.y - c.y) < mm(1.0) for h in holes):
                continue
            if f"{fp.GetReference()}.{pad.GetNumber()}" in SIN_VIA_GND:
                gnd_stub_east(board, fp.GetReference(), pad.GetNumber())
                continue
            if gnd_via_next_to(board, free, fp.GetReference(), pad.GetNumber()):
                vias_gnd += 1
                holes.append(free.items[-2].GetPosition())  # the via just added (then its track)
            else:
                sin_gnd.append(f"{fp.GetReference()}.{pad.GetNumber()}")
    save(board, path)
    print(f"abanico: {vias_gnd} vías de GND "
          f"(sin lugar: {len(sin_gnd)}, quedan para los planos de L1 y L6)")
    return 0


# The VREG island of L4 (In3), since 24/11/2026: where most VREG pads are (the bottom part, MCU, sensors, NAND
# and charger; the west strip of the load switches; the east strip of the barometer and magnetometer). Above
# (under the GNSS patch) L4 stays a signal layer with GND fill. L4 sits between the GND planes of L2 and L5, so the
# island takes no return path from the RF of L1 or the signals of L3 and L6.
ISLA_VREG = [(0, 10), (10.5, 10), (10.5, 33.4), (40.5, 33.4), (40.5, 15), (50, 15), (50, 70), (0, 70)]


def in_isla(x: float, y: float) -> bool:
    poly = pcbnew.SHAPE_LINE_CHAIN()
    for px, py in ISLA_VREG:
        poly.Append(pt(px, py))
    poly.SetClosed(True)
    return poly.PointInside(pt(x, y)) and 0.8 < x < 49.2 and y < 69.2


def isla(path: Path) -> int:
    """After ``abanico``: the VREG island of L4 (filled, so the router sees it) and a VREG via next to every VREG
    pad over it, locked; the router joins those vias through the fill and routes the pads outside it to them."""
    board = pcbnew.LoadBoard(str(path))
    if any(z.GetZoneName() == "VREG_L4" for z in board.Zones()):
        raise SystemExit("La placa ya tiene la isla de VREG")
    zone(board, "VREG", pcbnew.In3_Cu, ISLA_VREG, "VREG_L4", 1)
    free = Free(board)
    vreg = board.FindNet("VREG").GetNetCode()
    done, failed = 0, []
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            if pad.GetNetCode() != vreg:
                continue
            c = pad.GetPosition()
            if not in_isla(pcbnew.ToMM(c.x) - ORIGIN[0], pcbnew.ToMM(c.y) - ORIGIN[1]):
                continue
            if gnd_via_next_to(board, free, fp.GetReference(), pad.GetNumber(), "VREG", in_isla):
                done += 1
            else:
                failed.append(f"{fp.GetReference()}.{pad.GetNumber()}")
    fill(board)
    save(board, path)
    print(f"isla: VREG en L4; vías de VREG {done} (sin lugar: {failed})")
    return 0


# The planes, all over the board: GND on L1, L3, L4 and L6 (L2 and L5 are the GND planes L2_GND and L5_GND, outside
# this step); every rail, VREG included, is tracks.


def planos(path: Path, grilla: bool = True) -> int:
    board = pcbnew.LoadBoard(str(path))
    if any(z.GetZoneName().startswith(("L1_", "L3_", "L4_", "L6_")) for z in board.Zones() if not z.GetIsRuleArea()):
        raise SystemExit("La placa ya tiene los planos")
    zone(board, "GND", pcbnew.F_Cu, BOARD_BOX, "L1_GND", 0)
    zone(board, "GND", pcbnew.In2_Cu, BOARD_BOX, "L3_GND", 0)
    zone(board, "GND", pcbnew.In3_Cu, BOARD_BOX, "L4_GND", 0)
    zone(board, "GND", pcbnew.B_Cu, BOARD_BOX, "L6_GND", 0)
    free = Free(board)
    added = {"rf": 0, "borde": 0, "grilla": 0}
    # 1. Along both sides of every RF_50 track, every 1.5 mm, as close as the coplanar gap allows.
    for t in list(board.GetTracks()):
        if t.Type() != pcbnew.PCB_TRACE_T or t.GetNetClassName() != "RF_50":
            continue
        (x0, y0), (x1, y1) = [(pcbnew.ToMM(p.x) - ORIGIN[0], pcbnew.ToMM(p.y) - ORIGIN[1]) for p in (t.GetStart(), t.GetEnd())]
        length = math.dist((x0, y0), (x1, y1))
        if length < 0.3:
            continue
        ux, uy = (x1 - x0) / length, (y1 - y0) / length
        steps = max(1, int(length // RF_PITCH))
        for i in range(steps + 1):
            cx, cy = x0 + ux * length * i / steps, y0 + uy * length * i / steps
            for side in (1, -1):
                for off in (0.9, 1.1, 1.4):
                    if stitch_via(board, free, cx - uy * off * side, cy + ux * off * side, 1.0):
                        added["rf"] += 1
                        break
    # 2. Along the board edge, 0.9 mm inside.
    for x in [0.9 + EDGE_PITCH * i for i in range(int(48.2 / EDGE_PITCH) + 1)]:
        for y in (0.9, 69.1):
            added["borde"] += bool(stitch_via(board, free, x, y, 1.2))
    for y in [0.9 + EDGE_PITCH * i for i in range(int(68.2 / EDGE_PITCH) + 1)]:
        for x in (0.9, 49.1):
            added["borde"] += bool(stitch_via(board, free, x, y, 1.2))
    # 3. A grid over the whole board (not while nets are left for hand routing: it would take their corridors).
    for i in range(int(50 / STITCH_PITCH) + 1 if grilla else 0):
        for j in range(int(70 / STITCH_PITCH) + 1):
            added["grilla"] += bool(stitch_via(board, free, 0.6 + i * STITCH_PITCH, 0.6 + j * STITCH_PITCH, 1.5))
    fill(board)
    save(board, path)
    # 4. A GND via next to every GND pad that the planes leave unconnected (small pads walled in by tracks).
    for _ in range(4):
        missing = unconnected_gnd_pads(path)
        if not missing and _:
            break
        board = pcbnew.LoadBoard(str(path))
        free = Free(board)
        done, failed = 0, []
        for ref, num in missing:
            if gnd_via_next_to(board, free, ref, num):
                done += 1
            else:
                failed.append(f"{ref}.{num}")
        n, left = stitch_fragments(board, free)
        added["pads"] = added.get("pads", 0) + done
        added["trozos"] = added.get("trozos", 0) + n
        fill(board)
        save(board, path)
        if failed or left:
            print("sin lugar para una vía de GND:", failed, f"({left} trozos de plano sin vía)")
    print(f"planos: GND en L1, L3, L4 y L6; vías de GND {added}")
    return 0


def drc_report(path: Path) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "drc.json"
        subprocess.run(["kicad-cli", "pcb", "drc", "--format", "json", "--severity-error", "--severity-warning",
                        "--output", str(report), str(path)], check=True, capture_output=True)
        return json.loads(report.read_text(encoding="utf-8"))


def bridge_via(board, via) -> bool:
    """Takes away ``via`` when the copper of its net reaches it on a single layer, joining the tracks that end inside
    it to its centre on that layer. False (and the via stays) when two layers or more reach it."""
    centre = via.GetPosition()
    reach = via.GetWidth(pcbnew.F_Cu) // 2
    ends, layers = [], set()
    for t in board.GetTracks():
        if t.Type() == pcbnew.PCB_VIA_T or t.GetNetCode() != via.GetNetCode():
            continue
        for p in (t.GetStart(), t.GetEnd()):
            if (p - centre).EuclideanNorm() <= reach:
                ends.append((t, p))
                layers.add(t.GetLayer())
    for f in board.GetFootprints():
        for pad in f.Pads():
            if pad.GetNetCode() == via.GetNetCode() and pad.HitTest(centre):
                layers |= {layer for layer in ALL_CU if pad.IsOnLayer(layer)}
    if len(layers) > 1:
        return False
    for t, p in ends:
        if p != centre:
            seg = pcbnew.PCB_TRACK(board)
            seg.SetStart(p)
            seg.SetEnd(centre)
            seg.SetWidth(t.GetWidth())
            seg.SetLayer(t.GetLayer())
            seg.SetNet(t.GetNet())
            board.Add(seg)
    board.Delete(via)
    return True


def podar(path: Path, colgadas: bool = True) -> int:
    """Leaves the board clean for the DRC: a dangling via (locked ones included) reached on one layer only becomes a
    track on that layer (``bridge_via``); then it takes away every track or via of ``resto`` (not locked) that the
    DRC reports in a violation (``laberinto.py`` models the rules on a grid and
    misses a few: a via of a GNSS_SENSITIVE net against a pad on the other side, the 0.2 mm of POWER_DOCK against a
    0.15 mm track, the mask opening of a fiducial) and every via or stub of a signal net that is left dangling (the
    escape vias in the BMD-340 pads of the nets still unrouted). Repeats until the DRC has nothing of that kind, and
    fills the zones each time."""
    removed = []
    for _ in range(40):
        data = drc_report(path)
        board = pcbnew.LoadBoard(str(path))
        # A via that its net reaches on one layer only (an escape via of abanico when the router joined the pad on
        # L1 instead) goes first, the tracks that end on it joined to its centre on that layer: taken away as
        # dangling copper, its locked stub took the pad off the net (NAND_MOSI, 25/11/2026).
        hanging = {it["uuid"] for v in data["violations"] if v["type"] == "via_dangling" for it in v["items"]}
        bridged = sum(bridge_via(board, t) for t in list(board.GetTracks())
                      if t.m_Uuid.AsString() in hanging and t.Type() == pcbnew.PCB_VIA_T)
        bad = {it["uuid"] for v in data["violations"] for it in v["items"]} - hanging
        drop = [t for t in board.GetTracks() if t.m_Uuid.AsString() in bad and not t.IsLocked()]
        # dangling copper of the signal nets (the scripted RF, USB and power copper ends inside pads, which the
        # connectivity test misreads, so it only looks at Default and GNSS_SENSITIVE)
        board.BuildConnectivity()
        conn = board.GetConnectivity()
        ids = {t.m_Uuid.AsString() for t in drop}
        drop += [t for t in board.GetTracks() if colgadas and t.m_Uuid.AsString() not in ids and t.GetNetname() != "GND"
                 and t.GetNetClassName() in ("Default", "GNSS_SENSITIVE") and conn.TestTrackEndpointDangling(t, False)]
        if not drop and not bridged:
            break
        removed += [t.GetNetname() for t in drop]
        for t in drop:
            board.Delete(t)  # Delete, not Remove: a removed item still owned by Python crashed pcbnew later
        fill(board)
        save(board, path)
    # the pieces of the GND planes that the pruning and the last fill cut off get their via to L2
    board = pcbnew.LoadBoard(str(path))
    stitched, _ = stitch_fragments(board, Free(board))
    if stitched:
        fill(board)
        save(board, path)
    left = [v for v in drc_report(path)["violations"]]
    print(f"podar: {stitched} vías de GND en trozos sueltos")
    print(f"podar: {len(removed)} pistas y vías sacadas, de {len(set(removed))} redes: {sorted(set(removed))}; "
          f"quedan {len(left)} violaciones")
    return 0 if not left else 1


def remate(path: Path) -> int:
    """After ``planos``: what is still not joined (a net that ``resto`` left) gets routed over the free space that is left, and the zones are filled again."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    board = pcbnew.LoadBoard(str(path))
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True), iterations=6)
    fill(board)
    save(board, path)
    print(f"remate: {done} conexiones ruteadas; sin ruta: {failed}")
    return 0


def resto(path: Path, vueltas: int = 24) -> int:
    """Everything that criticas leaves, but GND, with the maze router of laberinto.py (``vueltas`` rounds of
    negotiation)."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    board = pcbnew.LoadBoard(str(path))
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True), iterations=vueltas)
    save(board, path)
    print(f"resto: {done} conexiones ruteadas; sin ruta: {failed}")
    return 0


# Power nets stay put in ``reparar`` (unless they are the broken ones): ripped up with the signals, the rails of the
# first try (25/11/2026) did not fit back.
RIELES = {"VREG", "VCC_GNSS", "VDD_EXT", "SYS", "BAT", "V_BCKP", "/storage/VCC_NAND", "/mcu_radio/VCC_LORA"}


def rieles(path: Path, vueltas: int = 24) -> int:
    """After ``abanico``, before ``resto``: the power rails (``RIELES``) alone with the maze router, then locked, so
    the signals of ``resto`` route around them (routed together, VREG lost the room to the signals, 25/11/2026)."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    board = pcbnew.LoadBoard(str(path))
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True), iterations=vueltas, only=RIELES)
    codes = {board.FindNet(n).GetNetCode() for n in RIELES if board.FindNet(n)}
    locked = 0
    for t in board.GetTracks():
        if t.GetNetCode() in codes and not t.IsLocked():
            t.SetLocked(True)
            locked += 1
    save(board, path)
    print(f"rieles: {done} conexiones ruteadas, {locked} pistas y vías bloqueadas; sin ruta: {failed}")
    return 0


def reparar(path: Path, vueltas: int = 24, margen: float = 1.0) -> int:
    """After ``resto`` (before ``planos``): the nets it left unfinished, and every signal net with tracks across a
    corridor ``margen`` mm to each side of their missing connections, are ripped up and routed again together by the
    maze router, with the rest of the board (power rails included) fixed."""
    broken, areas = missing_connections(path, lambda a, b: [pcbnew.SHAPE_SEGMENT(a, b, mm(2 * margen))])
    return reroute_around(path, "reparar", broken, areas, vueltas)


def missing_connections(path: Path, shapes) -> tuple[set, list]:
    """The signal nets with a connection still missing (the DRC's, GND aside) and ``shapes(a, b)`` (KiCad shapes) for
    the two ends ``a`` and ``b`` of each one."""
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "drc.json"
        subprocess.run(["kicad-cli", "pcb", "drc", "--format", "json", "--severity-all", "--output", str(report),
                        str(path)], check=True, capture_output=True)
        data = json.loads(report.read_text(encoding="utf-8"))
    broken, areas = set(), []
    for item in data["unconnected_items"]:
        names = [re.search(r"\[([^\]]+)\]", it["description"]) for it in item["items"]]
        names = {m.group(1) for m in names if m}
        if not names or "GND" in names:
            continue
        broken |= names
        a, b = [pcbnew.VECTOR2I(mm(it["pos"]["x"]), mm(it["pos"]["y"])) for it in item["items"][:2]]
        areas += shapes(a, b)
    return broken, areas


def reroute_around(path: Path, step: str, broken: set, areas: list, vueltas: int) -> int:
    """``broken`` and every signal net (not GND, the rails or the classes of ``criticas``) with copper on ``areas``,
    ripped up and routed again together, with the rest of the board fixed."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    board = pcbnew.LoadBoard(str(path))
    rip = set(broken)
    for t in board.GetTracks():
        name = t.GetNetname()
        if t.IsLocked() or name == "GND" or name in RIELES or t.GetNetClassName() in laberinto.SKIP_CLASSES:
            continue
        shape = t.GetEffectiveShape(t.GetLayer() if t.Type() != pcbnew.PCB_VIA_T else pcbnew.F_Cu)
        if any(c.Collide(shape, 0) for c in areas):
            rip.add(name)
    removed = 0
    for t in list(board.GetTracks()):
        if not t.IsLocked() and t.GetNetname() in rip:
            board.Delete(t)
            removed += 1
    print(f"{step}: {len(broken)} redes sin terminar; se levantan {len(rip)} redes ({removed} pistas y vías)", flush=True)
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True), iterations=vueltas, only=rip)
    save(board, path)
    print(f"{step}: {done} conexiones ruteadas; sin ruta: {failed}")
    return 0


def retocar(path: Path, radio: float = 1.5, vueltas: int = 24) -> int:
    """After ``podar``, for the few connections left: like ``reparar``, but only the nets with copper within
    ``radio`` mm of the two ends of each one are ripped up (28/11/2026: ``reparar``'s corridor along a 30 mm
    connection ripped up 40 nets and left more unfinished than before). ``planos``, ``remate``, ``podar``,
    ``rescate`` and ``podar`` go after it."""
    broken, areas = missing_connections(path, lambda a, b: [pcbnew.SHAPE_SEGMENT(p, p, mm(2 * radio)) for p in (a, b)])
    return reroute_around(path, "retocar", broken, areas, vueltas)


def walled_gnd_pads(board) -> list[tuple[str, str]]:
    """(ref, pad) of the GND pads on a piece of the GND fill of L1, L3, L4 or L6 that has no GND via or hole on it."""
    gnd = board.FindNet("GND").GetNetCode()
    vias = [t.GetPosition() for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T and t.GetNetCode() == gnd]
    vias += [p.GetPosition() for fp in board.GetFootprints() for p in fp.Pads()
             if p.GetNetCode() == gnd and p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH]
    found = []
    for z in board.Zones():
        if z.GetIsRuleArea() or z.GetNetCode() != gnd or z.GetLayer() in (pcbnew.In1_Cu, pcbnew.In4_Cu):
            continue
        polys = z.GetFilledPolysList(z.GetLayer())
        for i in range(polys.OutlineCount()):
            if any(polys.Contains(v, i) for v in vias):
                continue
            for fp in board.GetFootprints():
                for pad in fp.Pads():
                    if pad.GetNetCode() == gnd and pad.IsOnLayer(z.GetLayer()) and polys.Contains(pad.GetPosition(), i):
                        found.append((fp.GetReference(), pad.GetNumber()))
    return found


# The gap ``rescate`` keeps to other nets' copper (not CLEAR): without vias in the pads, at 0.25 mm the walled-in GND
# pads of R214 and R606 found no spot for their via (28/11/2026); 0.2 mm is still above every class but the GNSS
# and USB ones, which keep their own clearance through ``Free``.
RESCATE_CLEAR = 0.2


def rescate(path: Path, vueltas: int = 12) -> int:
    """After ``podar``: a GND pad that the routed signals walled in (its piece of the L1 fill has no via, 25/11/2026:
    R316 and R318 between the tracks of LED_DG and LED_DB) gets its via and short track as if only the locked copper
    were there; the signal nets that the new copper runs into are ripped up and routed again around it, and the
    zones are filled. ``podar`` goes after it again."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    pads = unconnected_gnd_pads(path)
    board = pcbnew.LoadBoard(str(path))
    gnd = board.FindNet("GND").GetNetCode()
    pads += [p for p in walled_gnd_pads(board) if p not in pads]
    free = Free(board, RESCATE_CLEAR)
    free.items = [it for it in free.items if it.Type() == pcbnew.PCB_PAD_T or it.IsLocked() or it.GetNetCode() == gnd]
    free.grid = {}
    for i, it in enumerate(free.items):
        free.index(i, it)
    before = {t.m_Uuid.AsString() for t in board.GetTracks()}
    placed = [(ref, num) for ref, num in pads if f"{ref}.{num}" in SIN_VIA_GND and gnd_stub_east(board, ref, num)
              or f"{ref}.{num}" not in SIN_VIA_GND and gnd_via_next_to(board, free, ref, num)]
    new = [t for t in board.GetTracks() if t.m_Uuid.AsString() not in before]
    rip = set()
    for t in board.GetTracks():
        if t.IsLocked() or t.GetNetCode() == gnd or t.GetNetClassName() in laberinto.SKIP_CLASSES:
            continue
        for item in new:
            layers = ALL_CU if item.Type() == pcbnew.PCB_VIA_T else [item.GetLayer()]
            if any(t.IsOnLayer(lay) and t.GetEffectiveShape(lay).Collide(item.GetEffectiveShape(lay), mm(CLEAR))
                   for lay in layers):
                rip.add(t.GetNetname())
                break
    for t in list(board.GetTracks()):
        if not t.IsLocked() and t.GetNetname() in rip:
            board.Delete(t)
    print(f"rescate: vía de GND para {placed} de {pads}; se levantan {sorted(rip)}", flush=True)
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True), iterations=vueltas, only=rip) \
        if rip else (0, [])
    fill(board)
    save(board, path)
    print(f"rescate: {done} conexiones ruteadas; sin ruta: {failed}")
    return 0


ESPECIALES = ("GNSS_SENSITIVE", "POWER_DOCK")


def especiales(path: Path) -> int:
    """Before handing the board to another router (Quilter): only the nets with rules of their own that it does not
    read (GNSS_SENSITIVE, POWER_DOCK), with the maze router; then ``podar`` and ``bloquear``."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    board = pcbnew.LoadBoard(str(path))
    only = {n.GetNetname() for n in board.GetNetsByNetcode().values() if n.GetNetClassName() in ESPECIALES}
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True), iterations=12, only=only)
    fill(board)
    save(board, path)
    print(f"especiales: {done} conexiones ruteadas de {len(only)} redes; sin ruta: {failed}")
    return 0


def bloquear(path: Path) -> int:
    """Locks every track and via, so another router keeps them as they are."""
    board = pcbnew.LoadBoard(str(path))
    n = 0
    for t in board.GetTracks():
        if not t.IsLocked():
            t.SetLocked(True)
            n += 1
    save(board, path)
    print(f"bloquear: {n} pistas y vías bloqueadas")
    return 0


def limpiar(path: Path) -> int:
    """Every track and via out, locked ones included, and the planes of ``planos`` (L2_GND, L5_GND and the rule
    areas stay): the start of a new routing from the placed board, before ``criticas --forzar`` (26/11/2026: after
    the parts that ``MOVES`` moved for the routing)."""
    board = pcbnew.LoadBoard(str(path))
    n = 0
    for t in list(board.GetTracks()):
        board.Delete(t)
        n += 1
    planes = [z for z in board.Zones()
              if not z.GetIsRuleArea() and z.GetZoneName().startswith(("L1_", "L3_", "L4_", "L6_"))]
    for z in planes:
        board.Delete(z)
    save(board, path)
    print(f"limpiar: {n} pistas y vías y {len(planes)} planos sacados")
    return 0


def save(board, path: Path) -> None:
    # Saving from Python rewrites the .kicad_pro with every default setting: keep the hand-kept project file.
    project = path.with_suffix(".kicad_pro")
    kept = project.read_bytes() if project.exists() else None
    board.Save(str(path))
    if kept is not None:
        project.write_bytes(kept)


def main(argv: list[str]) -> int:
    path = Path(argv[argv.index("--placa") + 1]) if "--placa" in argv else POD / "pod-v0.kicad_pcb"
    if len(argv) > 1 and argv[1] == "seis-capas":
        return seis_capas(path)
    if len(argv) > 1 and argv[1] == "abanico":
        return abanico(path)
    if len(argv) > 1 and argv[1] == "criticas":
        return criticas(path, "--forzar" in argv)
    if len(argv) > 2 and argv[1] == "dsn":
        return dsn(path, Path(argv[2]))
    if len(argv) > 2 and argv[1] == "ses":
        return ses(path, Path(argv[2]))
    if len(argv) > 1 and argv[1] == "remate":
        return remate(path)
    if len(argv) > 1 and argv[1] == "resto":
        return resto(path, int(argv[argv.index("--vueltas") + 1]) if "--vueltas" in argv else 24)
    if len(argv) > 1 and argv[1] == "especiales":
        return especiales(path)
    if len(argv) > 1 and argv[1] == "rieles":
        return rieles(path, int(argv[argv.index("--vueltas") + 1]) if "--vueltas" in argv else 24)
    if len(argv) > 1 and argv[1] == "reparar":
        return reparar(path, int(argv[argv.index("--vueltas") + 1]) if "--vueltas" in argv else 24,
                       float(argv[argv.index("--margen") + 1]) if "--margen" in argv else 1.0)
    if len(argv) > 1 and argv[1] == "retocar":
        return retocar(path, float(argv[argv.index("--radio") + 1]) if "--radio" in argv else 1.5,
                       int(argv[argv.index("--vueltas") + 1]) if "--vueltas" in argv else 24)
    if len(argv) > 1 and argv[1] == "rescate":
        return rescate(path, int(argv[argv.index("--vueltas") + 1]) if "--vueltas" in argv else 12)
    if len(argv) > 1 and argv[1] == "limpiar":
        return limpiar(path)
    if len(argv) > 1 and argv[1] == "isla":
        return isla(path)
    if len(argv) > 1 and argv[1] == "bloquear":
        return bloquear(path)
    if len(argv) > 1 and argv[1] == "podar":
        return podar(path, "--sin-colgadas" not in argv)
    if len(argv) > 1 and argv[1] == "planos":
        return planos(path, "--sin-grilla" not in argv)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
