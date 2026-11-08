"""Self-test of the custom DRC rules of the pod v0 (B-909).

kicad-cli does not fail, nor print anything, when a rule in pod-v0.kicad_dru does not parse or names
an unknown property: the rule is just ignored, and on an empty board the DRC stays green either way.
This script builds two probe boards from the pod-v0 board, its project and its rules:

- sonda.kicad_pcb: tracks, vias and footprints that break each rule on purpose. Its DRC report must
  name every rule.
- sonda_ok.kicad_pcb (negative control): a compliant layout (CPWG with GND exactly at the coplanar
  gap, other nets at the required distance, the USB pair at its geometry, a 1.5 mm inner 1 A rail,
  a GND via and the patch inside the GNSS zone, a bottom-side part under it). Its report must have no
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

import shutil
import sys
import uuid
from pathlib import Path

POD = Path(__file__).resolve().parents[1] / "pod-v0"
NS = uuid.UUID("2f1c5a0e-6b1d-4c39-9a57-1f4b8f3c0a11")

NETS = ["GND", "/gnss_rf/GNSS_RF_A", "/power/BB_LX1", "USB_D_P", "USB_D_N", "SYS", "GNSS_PPS",
        "/mcu_radio/LED_R", "/mcu_radio/LED_G", "/gnss_rf/GNSS_RF_B"]

# Coordinates in mm on the 45 x 65 mm outline (100..145, 100..165). Zones: BLE_ANTENA x 100-103.5,
# y 137-148; GNSS_ANTENA x 105-140, y 101-136; LORA_ANTENA x 125-145, y 150-165.
# Track: (net, layer, x0, y0, x1, y1, width). Via: (net, x, y). Footprint: (ref, x, y, side, pads),
# pad: (number, dx, dy, width, height, net or None).
PAD = (("1", 0, 0, 0.8, 0.8, None),)
R0402 = lambda a, b: (("1", -0.48, 0, 0.56, 0.62, a), ("2", 0.48, 0, 0.56, 0.62, b))  # noqa: E731

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
        ("GNSS_PPS", "F.Cu", 130, 158, 140, 158, 0.2),  # inside LORA_ANTENA
        ("/mcu_radio/LED_R", "F.Cu", 110, 110, 120, 110, 0.2),  # inside GNSS_ANTENA on L1
        ("/mcu_radio/LED_R", "F.Cu", 101, 140, 104, 140, 0.2),  # inside BLE_ANTENA
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 128, 140.5, 138, 140.5, 0.33),  # 0.3 mm from the pad of J1
    ],
    "vias": [("/gnss_rf/GNSS_RF_A", 120, 140)],  # via on an RF net
    "footprints": [
        ("R1", 125, 125, "F", PAD),  # top-side part under the GNSS antenna
        ("J1", 133, 139.5, "F", (("1", 0, 0, 0.8, 0.8, "/mcu_radio/LED_G"),)),  # other net near RF
    ],
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
    "GNSS_SENSITIVE: fuera de la zona de LoRa",
    "GNSS_ANTENA: solo GND y RF en L1",
    "GNSS_ANTENA: sin componentes debajo de la antena",
]
# The native keep-out of BLE_ANTENA is reported without its name ("Local override"): look for
# an items_not_allowed violation at the track placed inside it.
BLE_KEEPOUT_AT = "@(101.0000 mm, 140.0000 mm)"

OK = {
    "tracks": [
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 108, 140, 118, 140, 0.33),  # CPWG 0.33 mm
        ("GND", "F.Cu", 108, 139.535, 118, 139.535, 0.2),  # GND exactly 0.20 mm away
        ("/mcu_radio/LED_R", "F.Cu", 108, 140.865, 118, 140.865, 0.2),  # other net 0.6 mm away
        ("USB_D_P", "F.Cu", 108, 150, 118, 150, 0.25),  # pair 0.25 mm, 0.15 mm apart
        ("USB_D_N", "F.Cu", 108, 150.4, 118, 150.4, 0.25),
        ("SYS", "In2.Cu", 108, 154, 118, 154, 1.5),  # 1 A rail on an inner layer
        ("GNSS_PPS", "F.Cu", 108, 158, 118, 158, 0.2),
        ("/mcu_radio/LED_G", "F.Cu", 108, 158.5, 118, 158.5, 0.2),  # 0.3 mm from PPS
        ("/power/BB_LX1", "F.Cu", 128, 145, 138, 145, 0.4),  # switch node far from RF and zones
        ("/gnss_rf/GNSS_RF_A", "F.Cu", 115, 120, 125, 120, 0.33),  # RF inside the GNSS zone
    ],
    "vias": [("GND", 120, 125)],  # stitching via inside the GNSS zone
    "footprints": [
        ("AE201", 115, 130, "F", PAD),  # the patch may sit in the GNSS zone
        ("R2", 130, 125, "B", PAD),  # bottom-side part under the GNSS zone
        ("R3", 112, 145, "F", R0402("/gnss_rf/GNSS_RF_A", "/mcu_radio/LED_R")),  # bias-T: 0.4 mm pad gap
        ("R4", 120, 147, "F", R0402("/gnss_rf/GNSS_RF_A", "/gnss_rf/GNSS_RF_B")),  # 0 ohm between RF nets
    ],
}
# Violations that a probe board always has and that say nothing about the rules.
OK_ALLOWED = {"track_dangling", "via_dangling", "unconnected_items", "lib_footprint_issues",
              "lib_footprint_mismatch"}


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, "/".join(map(str, parts))))


def footprint(ref: str, x: float, y: float, side: str, pads: tuple, code: dict) -> str:
    cu, silk, crt, paste, mask = (f"{side}.{n}" for n in ("Cu", "SilkS", "CrtYd", "Paste", "Mask"))
    font = "(effects (font (size 1 1) (thickness 0.15))" + (" (justify mirror)" if side == "B" else "") + ")"
    out = (f'\t(footprint "sonda:{ref}" (layer "{cu}") (uuid "{uid("fp", ref)}") (at {x} {y})\n'
           f'\t\t(property "Reference" "{ref}" (at 0 -2 0) (layer "{silk}") (uuid "{uid("ref", ref)}") {font})\n'
           f'\t\t(property "Value" "sonda" (at 0 2 0) (layer "{side}.Fab") (uuid "{uid("val", ref)}") {font})\n'
           f'\t\t(attr smd)\n'
           f'\t\t(fp_rect (start -1 -1) (end 1 1) (stroke (width 0.05) (type default)) (fill none) '
           f'(layer "{crt}") (uuid "{uid("crt", ref)}"))\n')
    for num, dx, dy, w, h, net in pads:
        net_s = f' (net {code[net]} "{net}")' if net else ""
        out += (f'\t\t(pad "{num}" smd rect (at {dx} {dy}) (size {w} {h}) (layers "{cu}" "{paste}" "{mask}")'
                f'{net_s} (uuid "{uid("pad", ref, num)}"))\n')
    return out + "\t)\n"


def write_board(out: Path, stem: str, spec: dict) -> None:
    board = (POD / "pod-v0.kicad_pcb").read_text(encoding="utf-8")
    code = {name: i for i, name in enumerate(NETS, start=1)}
    nets = '(net 0 "")\n' + "".join(f'\t(net {i} "{name}")\n' for name, i in code.items())
    assert board.count('(net 0 "")\n') == 1, "pod-v0.kicad_pcb: expected only the empty net"
    board = board.replace('(net 0 "")\n', nets, 1)
    items = "".join(footprint(*f, code) for f in spec["footprints"])
    for i, (net, layer, x0, y0, x1, y1, w) in enumerate(spec["tracks"]):
        items += (f'\t(segment (start {x0} {y0}) (end {x1} {y1}) (width {w}) (layer "{layer}") '
                  f'(net {code[net]}) (uuid "{uid(stem, "seg", i)}"))\n')
    for i, (net, x, y) in enumerate(spec["vias"]):
        items += (f'\t(via (at {x} {y}) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") '
                  f'(net {code[net]}) (uuid "{uid(stem, "via", i)}"))\n')
    end = board.rstrip().rfind(")")
    (out / f"{stem}.kicad_pcb").write_text(board[:end] + items + ")\n", encoding="utf-8")
    shutil.copyfile(POD / "pod-v0.kicad_pro", out / f"{stem}.kicad_pro")
    shutil.copyfile(POD / "pod-v0.kicad_dru", out / f"{stem}.kicad_dru")
    print(f"Placa de prueba en {out / (stem + '.kicad_pcb')}")


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
