"""Self-test of the custom DRC rules of the pod v0 (B-909).

kicad-cli does not fail, nor print anything, when a rule in pod-v0.kicad_dru does not parse or names
an unknown property: the rule is just ignored, and on an empty board the DRC stays green either way.
This script builds two probe boards from the pod-v0 board, its project and its rules:

- sonda.kicad_pcb: tracks, vias and footprints that break each rule on purpose. Its DRC report must
  name every rule.
- sonda_ok.kicad_pcb (negative control): a compliant layout (CPWG with GND exactly at the coplanar
  gap, other nets at the required distance, the USB pair at its geometry, a 1.5 mm inner 1 A rail,
  a GND via and the patch inside the GNSS zone, the patch feed on L4 with its RF via, a bottom-side
  part under it, the LoRa feed on L1 inside LORA_ANTENA with the real chip antenna footprint, rotated 180
  degrees as on the pod, and its two 0402 capacitors at their data-sheet places, so that their courtyards are
  checked too). Its report must have no
  rule violations, only the ones a probe board always has (dangling tracks, unconnected items,
  footprints that are not in a library).

Standard library only.

    python3 hardware/tools/sonda_drc.py armar <dir>      # writes <dir>/sonda*.kicad_{pcb,pro,dru}
    kicad-cli pcb drc --severity-all --all-track-errors --output sonda.rpt <dir>/sonda.kicad_pcb
    kicad-cli pcb drc --severity-all --all-track-errors --output sonda_ok.rpt <dir>/sonda_ok.kicad_pcb
    python3 hardware/tools/sonda_drc.py verificar sonda.rpt
    python3 hardware/tools/sonda_drc.py verificar-ok sonda_ok.rpt
"""

from __future__ import annotations

import re
import shutil
import sys
import uuid
from pathlib import Path

POD = Path(__file__).resolve().parents[1] / "pod-v0"
NS = uuid.UUID("2f1c5a0e-6b1d-4c39-9a57-1f4b8f3c0a11")

NETS = ["GND", "/gnss_rf/GNSS_RF_A", "/power/BB_LX1", "USB_D_P", "USB_D_N", "SYS", "GNSS_PPS",
        "/mcu_radio/LED_R", "/mcu_radio/LED_G", "/gnss_rf/GNSS_RF_B", "/gnss_rf/GNSS_ANT_PATCH", "VREG",
        "/mcu_radio/LORA_FEED", "/mcu_radio/LORA_ANT_TUNE"]

# Coordinates in mm on the 50 x 70 mm outline (100..150, 100..170; doc origin (0; 0) = (100; 100)).
# Zones: BLE_ANTENA x 100-104.35, y 147.6-162.6; GNSS_ANTENA x 110-140, y 102-132; L3_GND (In2.Cu) the
# top third (y < 133) plus x 105-117, y 133-155; LORA_ANTENA x 126.7-142.7, y 159.05-170 (keep-out of the
# M620720 chip antenna on the bottom edge).
# Board screws (GND) at (106; 108), (144; 108) and (124; 166). The L2_GND plane is left out of the
# probes: its fill was computed without them.
# Track: (net, layer, x0, y0, x1, y1, width). Via: (net, x, y). Footprint: (ref, x, y, side, pads),
# pad: (number, dx, dy, width, height, net or None). Zone: (net, layer, [(x, y), ...]), outline only.
PAD = (("1", 0, 0, 0.8, 0.8, None),)
R0402 = lambda a, b: (("1", -0.48, 0, 0.56, 0.62, a), ("2", 0.48, 0, 0.56, 0.62, b))  # noqa: E731
# KiCad's C_0402_1005Metric: pads at +/-0.51, 0.54 x 0.64, courtyard +/-0.93 x +/-0.47 (6th field of a footprint).
C0402 = lambda a, b: (("1", -0.51, 0, 0.54, 0.64, a), ("2", 0.51, 0, 0.54, 0.64, b))  # noqa: E731
C0402_CRT = (0.93, 0.47)
# The chip antenna from the pod library, as placed on the pod: (ref, file, x, y, rotation, {pad: net}).
ANTENNA = ("AE301", Path(__file__).resolve().parents[1] / "lib" / "pod.pretty" / "KyoceraAVX_M620720_6.0x2.0mm.kicad_mod",
           138.6, 168.65, 180, {"1": "/mcu_radio/LORA_FEED", "3": "/mcu_radio/LORA_ANT_TUNE"})

BAD = {
    "tracks": [
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 108, 140, 118, 140, 0.2),  # too narrow for RF_50
        ("GND", "F.Cu", 108, 140.35, 118, 140.35, 0.2),  # 0.15 mm from the RF track
        ("/mcu_radio/LED_R", "F.Cu", 108, 139.5, 118, 139.5, 0.2),  # 0.3 mm from the RF track
        ("/power/BB_LX1", "F.Cu", 108, 142, 118, 142, 0.4),  # 2 mm from the RF track
        ("/gnss_rf/GNSS_RF_A", "B.Cu", 108, 144, 118, 144, 0.33),  # RF on L4
        ("/gnss_rf/GNSS_RF_A", "In2.Cu", 108, 146, 118, 146, 0.33),  # RF on L3
        ("USB_D_P", "F.Cu", 108, 150, 118, 150, 0.2),  # pair too narrow
        ("USB_D_N", "F.Cu", 108, 150.4, 118, 150.4, 0.2),
        ("SYS", "In2.Cu", 108, 154, 118, 154, 0.6),  # 1 A rail too narrow on an inner layer
        ("GNSS_PPS", "F.Cu", 108, 158, 118, 158, 0.2),
        ("/mcu_radio/LED_G", "F.Cu", 108, 158.4, 118, 158.4, 0.2),  # 0.2 mm from PPS
        ("/mcu_radio/LED_G", "In1.Cu", 108, 162, 118, 162, 0.2),  # not GND on L2
        ("/mcu_radio/LED_R", "F.Cu", 131, 161.5, 135, 161.5, 0.2),  # not RF, inside LORA_ANTENA on L1
        ("/mcu_radio/LORA_FEED", "In2.Cu", 131, 164, 135, 164, 0.33),  # the feed, but on L3 inside LORA_ANTENA
        ("/gnss_rf/GNSS_RF_B", "F.Cu", 128, 160.5, 131, 160.5, 0.33),  # RF on L1, but not LoRa's
        ("/mcu_radio/LED_R", "F.Cu", 110, 110, 120, 110, 0.2),  # inside GNSS_ANTENA on L1
        ("/mcu_radio/LED_R", "F.Cu", 101, 155, 104, 155, 0.2),  # inside BLE_ANTENA
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 128, 140.5, 138, 140.5, 0.33),  # 0.3 mm from the pad of J1
        ("VREG", "In2.Cu", 125, 120, 125, 126, 0.3),  # not GND on L3 under the patch feed
        ("/gnss_rf/GNSS_ANT_PATCH", "B.Cu", 128, 125, 138, 125, 0.2),  # patch feed too narrow on L4
        ("/gnss_rf/GNSS_ANT_PATCH", "In2.Cu", 128, 146, 138, 146, 0.33),  # patch feed on L3: still forbidden
    ],
    "vias": [("/gnss_rf/GNSS_RF_A", 120, 140),  # via on an RF net
             ("GND", 138, 166)],  # even a GND via inside LORA_ANTENA (native keep-out)
    "zones": [],
    "footprints": [
        ("R1", 125, 125, "F", PAD),  # top-side part under the GNSS antenna
        ("J1", 133, 139.5, "F", (("1", 0, 0, 0.8, 0.8, "/mcu_radio/LED_G"),)),  # other net near RF
        ("R5", 140, 162, "F", PAD),  # a part that is not the antenna or its capacitors inside LORA_ANTENA
        ("R6", 132, 165, "B", PAD),  # the same on the bottom side
    ],
    "graphics": [("F.Cu", 129, 167.5, 131, 167.5)],  # copper drawing inside LORA_ANTENA
}

# Rule names that the report of the bad board must mention.
EXPECTED = [
    "L2 solo GND",
    "RF_50: ancho de 50 ohm en L1",
    "RF_50: solo en L1 (internas)",
    "RF_50: solo en L1 (L4)",
    "RF_50: sin vías",
    "RF_50: separación coplanar a GND",
    "RF_50: otras redes lejos",
    "netclass 'RF_50'",
    "USB_90D: geometría del par",
    "POWER_DOCK: ancho en capas internas",
    "SW_NODE: lejos de la RF y del GNSS",
    "GNSS_SENSITIVE: otras señales lejos",
    "GNSS_ANTENA: solo GND y RF en L1",
    "GNSS_ANTENA: sin componentes debajo de la antena",
    "L3_GND: L3 solo GND debajo de L4",
    "RF_50: ancho de 50 ohm en L4 (alimentación del patch)",
    "LORA_ANTENA: sin dibujos ni textos de cobre",
]
# The GNSS_ANT_PATCH exception covers L4 and its via only: the inner-layer rule must still flag it.
PATCH_INNER = ("RF_50: solo en L1 (internas)", "GNSS_ANT_PATCH")
# The native keep-out of BLE_ANTENA is reported without its name ("Local override"): look for
# an items_not_allowed violation at the track placed inside it.
BLE_KEEPOUT_AT = "@(101.0000 mm, 155.0000 mm)"
LORA_VIA_AT = "@(138.0000 mm, 166.0000 mm)"  # same for the via inside LORA_ANTENA
# The LoRa track rule has two halves (any layer but L1, any net but the feed): its name at each track.
LORA_RULE = "LORA_ANTENA: solo la alimentación en L1"
LORA_TRACKS_AT = {"L1, otra red": "@(131.0000 mm, 161.5000 mm)", "alimentación en L3": "@(131.0000 mm, 164.0000 mm)",
                  "RF del GNSS en L1": "@(128.0000 mm, 160.5000 mm)"}
# The footprint rule, on both sides: its name in the block of each footprint.
LORA_FOOTPRINT_RULE = "LORA_ANTENA: solo la antena y sus capacitores"
LORA_FOOTPRINTS = {"arriba": "R5", "abajo": "R6"}

OK = {
    "tracks": [
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 108, 140, 118, 140, 0.33),  # CPWG 0.33 mm
        ("GND", "F.Cu", 108, 139.535, 118, 139.535, 0.2),  # GND exactly 0.20 mm away
        ("/mcu_radio/LED_R", "F.Cu", 108, 140.865, 118, 140.865, 0.2),  # other net 0.6 mm away
        ("USB_D_P", "F.Cu", 108, 150, 118, 150, 0.25),  # pair 0.25 mm, 0.15 mm apart
        ("USB_D_N", "F.Cu", 108, 150.4, 118, 150.4, 0.25),
        ("SYS", "In2.Cu", 108, 157, 118, 157, 1.5),  # 1 A rail on an inner layer, below L3_GND
        ("GNSS_PPS", "F.Cu", 108, 158, 118, 158, 0.2),
        ("/mcu_radio/LED_G", "F.Cu", 108, 158.5, 118, 158.5, 0.2),  # 0.3 mm from PPS
        ("/power/BB_LX1", "F.Cu", 128, 145, 138, 145, 0.4),  # switch node far from RF and zones
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 115, 120, 125, 120, 0.33),  # RF inside the GNSS zone
        ("/gnss_rf/GNSS_ANT_PATCH", "B.Cu", 125, 119.5, 125, 131, 0.33),  # patch feed on L4 (the one exception)
        ("/gnss_rf/GNSS_ANT_PATCH", "F.Cu", 125, 131, 125, 134, 0.33),  # and back on L1 after its via
        ("/mcu_radio/LORA_FEED", "F.Cu", 141.15, 157.9, 141.15, 167.6, 0.33),  # LoRa feed on L1 into pin 1
    ],
    "vias": [("GND", 120, 125),  # stitching via inside the GNSS zone
             ("/gnss_rf/GNSS_ANT_PATCH", 125, 131)],  # the patch feed's RF via
    "zones": [("GND", "In2.Cu", [(123.5, 118.5), (126.5, 118.5), (126.5, 132), (123.5, 132)])],  # GND island on L3
    "footprints": [
        ("AE201", 115, 130, "F", PAD),  # the patch may sit in the GNSS zone
        ("R2", 130, 125, "B", PAD),  # bottom-side part under the GNSS zone
        ("R3", 112, 145, "F", R0402("/gnss_rf/GNSS_RF_A", "/mcu_radio/LED_R")),  # bias-T: 0.4 mm pad gap
        ("R4", 120, 147, "F", R0402("/gnss_rf/GNSS_RF_A", "/gnss_rf/GNSS_RF_B")),  # 0 ohm between RF nets
        # P2 on the feed and P1 at the end of the arm, at their data-sheet places (antenna rotated 180 degrees):
        # one pad over the edge of the keep-out, and their courtyards next to the antenna's.
        ("C313", 142.45, 166.9, "F", C0402("/mcu_radio/LORA_FEED", "GND"), C0402_CRT),
        ("C314", 126.95, 169.35, "F", C0402("GND", "/mcu_radio/LORA_ANT_TUNE"), C0402_CRT),
    ],
    "antenna": True,
}
# Violations that a probe board always has and that say nothing about the rules.
OK_ALLOWED = {"track_dangling", "via_dangling", "unconnected_items", "lib_footprint_issues",
              "lib_footprint_mismatch"}


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, "/".join(map(str, parts))))


def footprint(ref: str, x: float, y: float, side: str, pads: tuple, crt_half: tuple = (1, 1)) -> str:
    cu, silk, crt, paste, mask = (f"{side}.{n}" for n in ("Cu", "SilkS", "CrtYd", "Paste", "Mask"))
    cw, ch = crt_half
    font = "(effects (font (size 1 1) (thickness 0.15))" + (" (justify mirror)" if side == "B" else "") + ")"
    out = (f'\t(footprint "sonda:{ref}" (layer "{cu}") (uuid "{uid("fp", ref)}") (at {x} {y})\n'
           # The parts with a real 0402 courtyard sit next to screws and pads: their reference is hidden.
           f'\t\t(property "Reference" "{ref}" (at 0 -2 0) (layer "{silk}") '
           f'{"(hide yes) " if crt_half != (1, 1) else ""}(uuid "{uid("ref", ref)}") {font})\n'
           f'\t\t(property "Value" "sonda" (at 0 2 0) (layer "{side}.Fab") (uuid "{uid("val", ref)}") {font})\n'
           f'\t\t(attr smd)\n'
           f'\t\t(fp_rect (start {-cw} {-ch}) (end {cw} {ch}) (stroke (width 0.05) (type default)) (fill none) '
           f'(layer "{crt}") (uuid "{uid("crt", ref)}"))\n')
    for num, dx, dy, w, h, net in pads:
        net_s = f' (net "{net}")' if net else ""
        out += (f'\t\t(pad "{num}" smd rect (at {dx} {dy}) (size {w} {h}) (layers "{cu}" "{paste}" "{mask}")'
                f'{net_s} (uuid "{uid("pad", ref, num)}"))\n')
    return out + "\t)\n"


def write_board(out: Path, stem: str, spec: dict) -> None:
    board = without_zone((POD / "pod-v0.kicad_pcb").read_text(encoding="utf-8"), "L2_GND")
    known = set(NETS)
    for item in spec["tracks"] + spec["vias"] + spec["zones"]:
        assert item[0] in known, f"{item[0]}: not in NETS"
    items = "".join(footprint(*f) for f in spec["footprints"])
    if spec.get("antenna"):
        items += library_footprint(*ANTENNA)
    for i, (layer, x0, y0, x1, y1) in enumerate(spec.get("graphics", [])):
        items += (f'\t(gr_line (start {x0} {y0}) (end {x1} {y1}) (stroke (width 0.2) (type solid)) '
                  f'(layer "{layer}") (uuid "{uid(stem, "gr", i)}"))\n')
    for i, (net, layer, x0, y0, x1, y1, w) in enumerate(spec["tracks"]):
        items += (f'\t(segment (start {x0} {y0}) (end {x1} {y1}) (width {w}) (layer "{layer}") '
                  f'(net "{net}") (uuid "{uid(stem, "seg", i)}"))\n')
    for i, (net, x, y) in enumerate(spec["vias"]):
        items += (f'\t(via (at {x} {y}) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") '
                  f'(net "{net}") (uuid "{uid(stem, "via", i)}"))\n')
    for i, (net, layer, pts) in enumerate(spec["zones"]):
        xy = " ".join(f"(xy {x} {y})" for x, y in pts)
        items += (f'\t(zone (net "{net}") (layer "{layer}") (uuid "{uid(stem, "zone", i)}") '
                  f'(hatch edge 0.5) (connect_pads (clearance 0.2)) (min_thickness 0.2) (filled_areas_thickness no) '
                  f'(fill (thermal_gap 0.5) (thermal_bridge_width 0.5)) (polygon (pts {xy})))\n')
    end = board.rstrip().rfind(")")
    (out / f"{stem}.kicad_pcb").write_text(board[:end] + items + ")\n", encoding="utf-8")
    shutil.copyfile(POD / "pod-v0.kicad_pro", out / f"{stem}.kicad_pro")
    shutil.copyfile(POD / "pod-v0.kicad_dru", out / f"{stem}.kicad_dru")
    print(f"Placa de prueba en {out / (stem + '.kicad_pcb')}")


def library_footprint(ref: str, path: Path, x: float, y: float, rot: float, nets: dict) -> str:
    """A footprint of the pod library placed on the board: one pad per line, as footprints_hoja.py writes them.

    Pad angles in a board file are absolute, so each pad gets the footprint rotation. The footprint's own
    keep-out zone is left out (in a board its outline is in board coordinates); the board's LORA_ANTENA covers it.
    """
    out = []
    for line in path.read_text(encoding="utf-8").splitlines()[1:-1]:
        t = line.strip()
        if t.startswith(("(version", "(generator", "(zone", "(layer ")):
            continue
        if t.startswith("(pad "):
            num = t.split('"')[1]
            t = re.sub(r"\(at ([-\d.]+) ([-\d.]+)\)", rf"(at \1 \2 {rot})", t, count=1)
            net = f' (net "{nets[num]}")' if num in nets else ""
            t = t[:-1] + f'{net} (uuid "{uid("libpad", ref, num, len(out))}"))'
        t = t.replace('"REF**"', f'"{ref}"')
        out.append("\t\t" + t)
    head = f'\t(footprint "pod:{path.stem}" (layer "F.Cu") (uuid "{uid("fp", ref)}") (at {x} {y} {rot})\n'
    return head + "\n".join(out) + "\n\t)\n"


def without_zone(board: str, name: str) -> str:
    """``board`` without the top-level zone called ``name`` (KiCad 10 writes one zone per block)."""
    start = board.find(f'(name "{name}")')
    if start < 0:
        return board
    begin = board.rfind("\n\t(zone", 0, start)
    depth, i = 0, begin + 2
    while True:
        depth += {"(": 1, ")": -1}.get(board[i], 0)
        i += 1
        if depth == 0:
            return board[:begin] + board[i:]


def blocks_of(report: Path) -> list[str]:
    blocks, current = [], []
    for line in report.read_text(encoding="utf-8").splitlines():
        if line.startswith("[") and current:
            blocks.append("\n".join(current))
            current = []
        current.append(line)
    blocks.append("\n".join(current))
    return [b for b in blocks if b.startswith("[")]


def verify(report: Path) -> int:
    text = report.read_text(encoding="utf-8")
    blocks = blocks_of(report)
    found = {name: name in text for name in EXPECTED}
    found["BLE_ANTENA (keep-out nativo)"] = any(
        b.startswith("[items_not_allowed]") and BLE_KEEPOUT_AT in b for b in blocks)
    found["LORA_ANTENA: vía (keep-out nativo)"] = any(
        b.startswith("[items_not_allowed]") and LORA_VIA_AT in b for b in blocks)
    for what, at in LORA_TRACKS_AT.items():
        found[f"{LORA_RULE} ({what})"] = any(LORA_RULE in b and at in b for b in blocks)
    for side, ref in LORA_FOOTPRINTS.items():
        found[f"{LORA_FOOTPRINT_RULE} ({side})"] = any(
            LORA_FOOTPRINT_RULE in b and f"Footprint {ref}" in b for b in blocks)
    found["GNSS_ANT_PATCH sigue prohibida en capas internas"] = any(all(t in b for t in PATCH_INNER) for b in blocks)
    for name, ok in found.items():
        print(("ok    " if ok else "FALTA ") + name)
    missing = [name for name, ok in found.items() if not ok]
    if missing:
        print(f"{len(missing)} reglas no aparecieron en el reporte: no se leyeron o no se aplican.")
        return 1
    print("Todas las reglas propias se aplican.")
    return 0


def verify_ok(report: Path) -> int:
    bad = [b for b in blocks_of(report) if b[1:b.index("]")] not in OK_ALLOWED]
    for b in bad:
        print("SOBRA " + b.replace("\n", "\n      "))
    if bad:
        print(f"{len(bad)} violaciones en la placa que cumple las reglas: alguna regla es demasiado estricta.")
        return 1
    print("La placa que cumple las reglas no tiene violaciones.")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "armar":
        out = Path(argv[2])
        out.mkdir(parents=True, exist_ok=True)
        write_board(out, "sonda", BAD)
        write_board(out, "sonda_ok", OK)
        return 0
    if len(argv) == 3 and argv[1] == "verificar":
        return verify(Path(argv[2]))
    if len(argv) == 3 and argv[1] == "verificar-ok":
        return verify_ok(Path(argv[2]))
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
