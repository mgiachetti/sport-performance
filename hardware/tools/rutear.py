"""Routing of the pod v0 board (B-909). One-shot tool, like ``ubicar.py``: after it runs, the board is the source.

Runs inside the official KiCad image (it needs KiCad's ``pcbnew`` module). Four steps, in this order:

``criticas``
    Moves the few passives listed in ``MOVES`` (each with its reason) and routes, by script and locked, the nets
    that must not be left to an autorouter: both RF chains (CPWG of ``RF_50`` on L1, the patch feed on L4 with its
    RF via) with their GND via fences, the USB pair (L4 inside the ``L3_GND`` strip, vias at x >= 14.5), the escape
    of the BMD-340 (every used pad to a via: the two top rows by L1 to two rows of vias above the module, the rest
    with a via in the pad), the crystal, VBUS from the spring through the TVS and the eFuse to the BMD-340 and the
    charger, BAT and SYS around the charger (with the cell sense of the MAX17048 on its own trace from the pad of
    ``J101``), the buck-boost (switch node, input and output loops) and DETECT. Refuses to run on a board that
    already has tracks (``--forzar`` to run it on a scratch copy anyway).

``dsn <out.dsn>``
    Exports the board to Specctra DSN for Freerouting and rewrites the areas Freerouting does not understand (it
    does not read ``pod-v0.kicad_dru``): see ``dsn_for_freerouting``.

``ses <in.ses>``
    Imports Freerouting's session into the board (KiCad keeps the locked tracks of ``criticas``).

``planos``
    Adds the copper zones (GND on L1, L3 and L4; VREG on L3), the stitching vias (around the RF, along the board
    edge and over the whole GND area) and a GND via next to every GND pad that the zones leave unconnected, and
    fills the zones.

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

RF = 0.33  # RF_50 CPWG on L1 and the patch feed on L4 (pod-v0.kicad_dru)
USB = 0.25  # USB_90D, pair gap 0.15
PWR = 0.5  # POWER_DOCK on the outer layers
VIA_RF = (0.6, 0.3)
VIA_PWR = (0.6, 0.3)
VIA_SIG = (0.5, 0.2)  # smallest via that meets PCBWay's minimums (0.45 mm, 0.2 mm hole, 0.15 mm ring)

LAYERS = {"F": pcbnew.F_Cu, "In1": pcbnew.In1_Cu, "In2": pcbnew.In2_Cu, "B": pcbnew.B_Cu}

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
    # BMD-340: VREG (pad 65) reaches its 100 nF and 4.7 uF on L1 with their VREG pad on the side of the pad.
    "C302": (15.85, 55.5, 270, "100 nF del BMD-340 girado: VREG del lado del pad 65"),
    "C301": (17.5, 55.5, 270, "4,7 uF del BMD-340 girado: VREG del lado del pad 65"),
    # LNA (U205, BGA525N6 at 0.4 mm): its control (CTRL1, pad 6) and supply (VCC, pad 2) pins sit between the RF
    # pads, so they leave west, between two capacitors that had to make room: C219 (VCC) turns and goes down 0.3 mm
    # with its VCC pad facing the LNA, and C220 (not mounted) moves out to the west.
    "C219": (23.5, 43.9, 180, "100 nF del LNA girado y bajado: VCC frente al pad 2 y lugar para el GND del pad 1"),
    "C220": (22.0, 44.0, 90, "capacitor sin montar del LNA corrido al oeste: dejaba sin salida al control (pad 6)"),
    # MAX17048: its BAT pins (2 and 3) are the middle two of the bottom row and C309 (the input capacitor of the
    # LoRa load switch) sat 0.29 mm below them, so they had no way out. C309 goes to the left of the load switch,
    # right above its VREG_LORA pin (pin 1).
    "C309": (27.3, 51.75, 180, "capacitor de VREG_LORA al lado del pin 1 de U303: dejaba encerrados los pines BAT del MAX17048"),
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
    # Feed into the clearance of the chip antenna along its right edge (the GND tongue of P2 is at x > 42.7),
    # through P2's pad (C313.1) to pin 1 of AE301.
    lengths["LORA_FEED"] = r.track("LORA_FEED", "F", RF, ["R328.2", (41.79, 58.5), (42.05, 58.76), (42.05, 66.9),
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
    # The pair on L4, 0.25 mm at 0.15 mm, west and then down the L3_GND strip (x 14.5-17), up to L1 by one pair of
    # vias east of pads 68 and 67 (inside the strip) and on L1 to the pads. KiCad checks the gap of every pair of
    # parallel segments that overlap, so the uncoupled ends never run parallel to each other: D+ drops straight
    # from its 0 ohm and D- at 45 degrees, the 45-degree corner keeps the 0.4 mm pitch (outer chamfer 0.234 mm
    # longer) and D- reaches its pad at an angle.
    p = r.track("USB_D_P", "B", USB, ["R608.2", (18.8, 16.5), (16.034, 16.5), (15.6, 16.934), (15.6, 51.0),
                                      (15.35, 51.25)])
    n = r.track("USB_D_N", "B", USB, ["R609.2", (19.71, 16.9), (16.2, 16.9), (16.0, 17.1), (16.0, 52.15),
                                      (15.3, 52.85)])
    r.via("USB_D_P", (15.35, 51.25))
    r.via("USB_D_N", (15.3, 52.85))
    p += r.track("USB_D_P", "F", USB, [(15.35, 51.25), "U301.68"])
    n += r.track("USB_D_N", "F", USB, [(15.3, 52.85), "U301.67"])
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
                               (41.75, 58.5), (15.3, 58.5), (15.3, 53.7)])
    # Up at pad 66 of the BMD-340 and its 4.7 uF (C303).
    r.via("VBUS", (15.3, 53.7), VIA_PWR)
    r.track("VBUS", "F", PWR, [(15.3, 53.7), "U301.66"])
    r.track("VBUS", "F", PWR, [(15.3, 53.7), (16.5, 53.7), (17.1, 53.1)])
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
    # C309 used to be). C104 (its 1 uF) on L4 under U102.
    r.track("BAT", "B", 0.25, [(11.35, 68.6), (11.35, 69.2), (18.7, 69.2), (19.0, 68.9), (19.0, 60.4), (19.5, 59.9),
                               (25.5, 59.9)])
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


# ---------------------------------------------------------------------------------------------------- BMD-340
def bmd340(r: Router) -> None:
    fp = r.fps["U301"]
    pads = {p.GetNumber(): p for p in fp.Pads()}
    skip = {"7", "13", "14", "65", "66", "67", "68"}  # not connected, crystal, VREG, VBUS, USB: routed apart
    for num, p in sorted(pads.items(), key=lambda kv: int(kv[0])):
        if num in skip:
            continue
        net = p.GetNetname()
        x, y = pcbnew.ToMM(p.GetPosition().x) - ORIGIN[0], pcbnew.ToMM(p.GetPosition().y) - ORIGIN[1]
        if abs(y - 50.7) < 0.01 and net != "GND":  # outer top row: L1 to a via above the module
            r.track(net, "F", 0.15, [(x, y), (x, 49.8)])
            r.via(net, (x, 49.8))
        elif abs(y - 51.6) < 0.01 and net != "GND":  # second top row: between two outer pads, via further north
            r.track(net, "F", 0.15, [(x, y), (x, 49.0)])
            r.via(net, (x, 49.0))
        else:  # everything else: a via in the pad (filled and capped, POFV)
            r.via(net, (x, y))
    # VREG (pad 65) to its 100 nF and 4.7 uF on L1 (both turned with VREG to this side).
    r.track("VREG", "F", 0.3, ["U301.65", (15.4, 54.55), "C302.1", "C301.1"])
    # Crystal: XL1 straight on L1; XL2 (second row) through a via in its pad, 2 mm on L3 and up next to the
    # crystal. Load capacitors on L1 below it.
    r.track("XL1", "F", 0.15, ["U301.13", (10.8, 60.6), "Y301.1"])
    r.track("XL1", "F", 0.15, ["Y301.1", (10.8, 62.45), (9.4, 62.45), "C304.1"])
    r.via("XL2", "U301.14")
    r.track("XL2", "In2", 0.15, ["U301.14", (11.55, 59.3), (11.75, 60.55)])
    r.via("XL2", (11.75, 60.55))
    r.track("XL2", "F", 0.15, [(11.75, 60.55), (12.2, 61.1), "Y301.2"])
    r.track("XL2", "F", 0.15, ["Y301.2", (12.2, 62.45), (13.6, 62.45), "C305.1"])


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
    bmd340(r)
    for k, v in lengths.items():
        print(f"largo {k}: {v:.2f} mm")
    sys.path.insert(0, str(TOOLS))
    import ubicar  # noqa: E402  (the reference placer of ubicar.py, for the moved parts)
    hidden = ubicar.place_references(board, set(MOVES) | {"U103"})  # U103's reference sat where C102 went
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
# Under the 32.768 kHz crystal (GNSS_SENSITIVE): nothing that switches on L3 or L4 (XL2's own L3 hop ends above it).
CRISTAL = (108500, 160800, 114500, 162900)
FR_VIA_DEFAULT = "Via[0-3]_500:200_um"
FR_WIDTHS = {"kicad_default": 200, "POWER_DOCK": 300}  # POWER_DOCK: only the low-current branches are left


def rect(layer: str, box: tuple, kind: str = "keepout") -> str:
    x0, y0, x1, y1 = box
    return f'    ({kind} "" (polygon {layer} 0  {x0} -{y0}  {x1} -{y0}  {x1} -{y1}  {x0} -{y1}  {x0} -{y0}))\n'


def dsn_for_freerouting(text: str) -> str:
    layers = re.findall(r"\(layer (\S+)\n\s+\(type", text)
    top, inner2, bottom = layers[0], layers[2], layers[3]
    gnss = f"{GNSS_ANTENA[0]} -{GNSS_ANTENA[1]}  {GNSS_ANTENA[2]} -{GNSS_ANTENA[1]}"
    lora = f"{LORA_ANTENA[0]} -{LORA_ANTENA[1]}  {LORA_ANTENA[2]} -{LORA_ANTENA[1]}"
    out, skip = [], False
    for line in text.splitlines(keepends=True):
        # the exported keep-outs of GNSS_ANTENA (all layers) and LORA_ANTENA (vias only) are replaced below; each
        # one takes two lines (the polygon closes on the next one)
        if skip:
            skip = False
            continue
        if line.lstrip().startswith(("(keepout", "(via_keepout")) and (gnss in line or lora in line):
            skip = not line.rstrip().endswith("))")
            continue
        out.append(line)
    text = "".join(out)
    # L3_GND (In2 only) is exported as a keep-out, which also stops vias: only tracks are forbidden there.
    text, n = re.subn(r"\(keepout(?= \"\" \(polygon " + re.escape(inner2) + r" 0  100000 -100000  150000 -100000  150000 -133000)",
                      "(wire_keepout", text)
    assert n == 1, "no encontré el keep-out de L3_GND en el DSN"
    extra = rect(top, GNSS_ANTENA)
    for layer in layers:
        extra += rect(layer, LORA_ANTENA)
    extra += rect(inner2, CRISTAL, "wire_keepout") + rect(bottom, CRISTAL, "wire_keepout")
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
    text = text.replace("    (via ", edge_keepouts(board, [layers[0], layers[2], layers[3]]) + "    (via ", 1)
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
        board.Remove(t)
    fill(board)
    save(board, path)
    print(f"sesión importada: {len(board.GetTracks())} pistas y vías ({locked} bloqueadas, {len(dupes)} copias quitadas)")
    return 0


# ----------------------------------------------------------------------------------------------------- planes
STITCH = (0.6, 0.3)  # stitching vias, GND
STITCH_PITCH = 2.5  # grid of the stitching over the whole board (mm)
EDGE_PITCH = 1.8  # along the board edge
RF_PITCH = 1.5  # along both sides of every RF_50 track
CLEAR = 0.25  # copper of another net (the GND-to-RF coplanar gap is 0.20)


class Free:
    """Answers "does this GND via or short GND track fit here?" against the copper of every other net, the
    keep-outs (rule areas and footprint keep-outs: anything that forbids something) and the board edge."""

    def __init__(self, board):
        self.gnd = board.FindNet("GND").GetNetCode()
        self.items = [pad for fp in board.GetFootprints() for pad in fp.Pads()] + list(board.GetTracks())
        self.areas = [z for z in board.Zones() if z.GetIsRuleArea()] + \
            [z for fp in board.GetFootprints() for z in fp.Zones() if z.GetIsRuleArea()]
        self.areas = [z for z in self.areas if z.GetDoNotAllowVias() or z.GetDoNotAllowTracks()
                      or z.GetDoNotAllowZoneFills() or z.GetDoNotAllowPads()]
        self.edges = [d.GetEffectiveShape() for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
        self.outline = pcbnew.SHAPE_POLY_SET()
        board.GetBoardPolygonOutlines(self.outline, False)
        self.grid = {}
        for i, it in enumerate(self.items):
            self.index(i, it)

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
            gnd = other.GetNetCode() == self.gnd
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
                gap = mm(CLEAR) if other.GetNetClassName() == "RF_50" else max(mm(CLEAR), other.GetOwnClearance(lay) + mm(0.02))
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
    if free.fits(v, [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu], min_gnd_via):
        board.Add(v)
        free.add(v)
        return v
    return None


def unconnected_gnd_pads(path: Path) -> list[tuple[str, str]]:
    """(ref, pad) of every GND pad that the DRC of ``path`` still reports as unconnected."""
    with tempfile.TemporaryDirectory() as tmp:
        report = Path(tmp) / "drc.json"
        subprocess.run(["kicad-cli", "pcb", "drc", "--format", "json", "--severity-all", "--output", str(report),
                        str(path)], check=True, capture_output=True)
        data = json.loads(report.read_text(encoding="utf-8"))
    found = []
    for item in data["unconnected_items"]:
        for it in item["items"]:
            m = re.match(r"(?:PTH )?[Pp]ad (\S+) \[GND\] of (\S+)", it["description"])
            if m and (m.group(2), m.group(1)) not in found:
                found.append((m.group(2), m.group(1)))
    return found


def stitch_fragments(board, free: Free) -> tuple[int, int]:
    """Every piece of the GND planes of L1, L3 and L4 gets at least one via to L2: a piece that only reaches a pad
    (walled in by tracks) would stay apart from the rest of the ground. Returns (vias added, pieces left)."""
    gnd = board.FindNet("GND").GetNetCode()
    vias = [t.GetPosition() for t in board.GetTracks() if t.Type() == pcbnew.PCB_VIA_T and t.GetNetCode() == gnd]
    vias += [p.GetPosition() for fp in board.GetFootprints() for p in fp.Pads()
             if p.GetNetCode() == gnd and p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH]
    added = left = 0
    for z in list(board.Zones()):
        if z.GetIsRuleArea() or z.GetNetCode() != gnd or z.GetLayer() == pcbnew.In1_Cu:
            continue
        polys = z.GetFilledPolysList(z.GetLayer())
        for i in range(polys.OutlineCount()):
            chain = polys.Outline(i)
            if any(chain.PointInside(v) for v in vias):
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


def gnd_via_next_to(board, free: Free, ref: str, num: str) -> bool:
    """A GND via next to a GND pad that the planes do not reach, with a short track on the pad's layer."""
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
                v = pcbnew.PCB_VIA(board)
                v.SetPosition(pt(x, y))
                v.SetWidth(mm(VIA_SIG[0]))
                v.SetDrill(mm(VIA_SIG[1]))
                v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                v.SetNet(board.FindNet("GND"))
                t = pcbnew.PCB_TRACK(board)
                t.SetStart(c)
                t.SetEnd(v.GetPosition())
                t.SetWidth(mm(0.25))
                t.SetLayer(layer)
                t.SetNet(board.FindNet("GND"))
                if free.fits(v, [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]) and free.fits(t, [layer]):
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
# L3 below the L3_GND area (the top third, y < 33, and the strip of the USB pair, x 14.5-17 down to y = 55).
L3_VREG = [(0, 33.4), (14.1, 33.4), (14.1, 55.4), (17.4, 55.4), (17.4, 33.4), (50, 33.4), (50, 70), (0, 70)]
L3_GND = [(0, 0), (50, 0), (50, 33), (17, 33), (17, 55), (14.5, 55), (14.5, 33), (0, 33)]


def planos(path: Path) -> int:
    board = pcbnew.LoadBoard(str(path))
    if any(z.GetZoneName().startswith(("L1_", "L4_", "L3_GND_")) for z in board.Zones() if not z.GetIsRuleArea()):
        raise SystemExit("La placa ya tiene los planos")
    zone(board, "GND", pcbnew.F_Cu, BOARD_BOX, "L1_GND", 0)
    zone(board, "GND", pcbnew.In2_Cu, L3_GND, "L3_GND_PLANO", 1)
    zone(board, "VREG", pcbnew.In2_Cu, L3_VREG, "L3_VREG", 0)
    zone(board, "GND", pcbnew.B_Cu, BOARD_BOX, "L4_GND", 0)
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
    # 3. A grid over the whole board.
    for i in range(int(50 / STITCH_PITCH) + 1):
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
    print(f"planos: L1, L3 (GND arriba y en la franja, VREG abajo) y L4; vías de GND {added}")
    return 0


def resto(path: Path) -> int:
    """Everything that criticas leaves, but GND, with the maze router of laberinto.py."""
    sys.path.insert(0, str(TOOLS))
    import laberinto  # noqa: E402
    board = pcbnew.LoadBoard(str(path))
    done, failed = laberinto.route_all(board, lambda m: print(m, flush=True))
    save(board, path)
    print(f"resto: {done} conexiones ruteadas; sin ruta: {failed}")
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
    if len(argv) > 1 and argv[1] == "criticas":
        return criticas(path, "--forzar" in argv)
    if len(argv) > 2 and argv[1] == "dsn":
        return dsn(path, Path(argv[2]))
    if len(argv) > 2 and argv[1] == "ses":
        return ses(path, Path(argv[2]))
    if len(argv) > 1 and argv[1] == "resto":
        return resto(path)
    if len(argv) > 1 and argv[1] == "planos":
        return planos(path)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
