"""Footprints of hardware/lib/pod.pretty drawn from the land pattern of the manufacturer's datasheet.

For parts whose LCSC/EasyEDA footprint does not match the datasheet (or has none) and that the official
KiCad libraries do not have, plus the dock pads (our own design). Each footprint cites the document,
page and figure its numbers come from, and stays "Verificado: no" until someone compares it in KiCad or
against the manufacturer's own footprint. The LC29H is built from the numeric pad table extracted from
Quectel's official footprint (hardware/tools/datos/, written by altium_pads.py).
Coordinates in mm, origin at the package centre, Y down, as seen from the top (KiCad's convention).

Standard library only (Python 3.9 or newer).

    python3 hardware/tools/footprints_hoja.py          # writes the .kicad_mod files
    python3 hardware/tools/footprints_hoja.py --check  # fails if a file is out of date (CI)
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib" / "pod.pretty"
DATA = Path(__file__).resolve().parent / "datos"
MODELS = "${KIPRJMOD}/../lib/pod.3dshapes"
HEADER = "Generado por hardware/tools/footprints_hoja.py: no editar a mano"


@dataclass
class Pad:
    number: str
    shape: str  # rect, roundrect, circle, custom
    x: float
    y: float
    w: float
    h: float
    layers: tuple = ("F.Cu", "F.Paste", "F.Mask")
    poly: list = field(default_factory=list)  # custom: outline relative to (x, y)
    mask_margin: float | None = None
    drill: float | None = None  # through-hole (thermal via)
    rratio: float = 0.0


@dataclass
class Footprint:
    name: str
    descr: str
    tags: str
    pads: list
    body: tuple  # (half width, half height) of the package, for F.Fab
    courtyard: tuple  # (half width, half height)
    pin1: tuple | None  # silk dot (x, y), or None when ``silk`` draws the pin 1 mark
    attr: str = "smd"
    model: str = ""
    model_rotate: float = 0
    fab_texts: list = field(default_factory=list)  # (text, x, y, size)
    comments: list = field(default_factory=list)  # Cmts.User: ("circle", x, y, r) or ("text", s, x, y)
    keepouts: list = field(default_factory=list)  # (name, layers, allowed, [(x, y), ...]); pours never allowed
    body_y: float = 0  # centre of the body and of the courtyard, when not at the origin
    courtyard_y: float = 0
    silk: list = field(default_factory=list)  # F.SilkS lines: (x0, y0, x1, y1, width)


def n(v: float) -> str:
    text = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def font(size: float) -> str:
    return f"(effects (font (size {n(size)} {n(size)}) (thickness {n(size * 0.15)})))"


def render(fp: Footprint) -> str:
    out = [f'(footprint "{fp.name}"', "\t(version 20240108)", '\t(generator "pcbnew")', '\t(generator_version "8.0")',
           '\t(layer "F.Cu")', f'\t(descr "{fp.descr}")', f'\t(tags "{fp.tags}")']
    bw, bh = fp.body
    cw, ch = fp.courtyard
    out.append(f'\t(property "Reference" "REF**" (at 0 {n(fp.courtyard_y - ch - 0.6)} 0) (layer "F.SilkS") {font(0.6)})')
    out.append(f'\t(property "Value" "{fp.name}" (at 0 {n(fp.courtyard_y + ch + 0.6)} 0) (layer "F.Fab") {font(0.4)})')
    out.append(f'\t(property "Description" "{HEADER}" (at 0 0 0) (unlocked yes) (layer "F.Fab") (hide yes) {font(1)})')
    out.append(f"\t(attr {fp.attr})")
    for layer, (hw, hh), cy, width in (("F.Fab", (bw, bh), fp.body_y, 0.1), ("F.CrtYd", (cw, ch), fp.courtyard_y, 0.05)):
        out.append(f'\t(fp_rect (start {n(-hw)} {n(cy - hh)}) (end {n(hw)} {n(cy + hh)}) '
                   f'(stroke (width {n(width)}) (type solid)) (fill none) (layer "{layer}"))')
    if fp.pin1:
        px, py = fp.pin1
        out.append(f'\t(fp_circle (center {n(px)} {n(py)}) (end {n(px + 0.1)} {n(py)}) '
                   f'(stroke (width 0.2) (type solid)) (fill solid) (layer "F.SilkS"))')
    for x0, y0, x1, y1, width in fp.silk:
        out.append(f'\t(fp_line (start {n(x0)} {n(y0)}) (end {n(x1)} {n(y1)}) '
                   f'(stroke (width {n(width)}) (type solid)) (layer "F.SilkS"))')
    out.append(f'\t(fp_text user "${{REFERENCE}}" (at 0 0 0) (layer "F.Fab") {font(min(0.5, bw * 0.6))})')
    for text, x, y, size in fp.fab_texts:
        out.append(f'\t(fp_text user "{text}" (at {n(x)} {n(y)} 0) (layer "F.Fab") {font(size)})')
    for c in fp.comments:
        if c[0] == "circle":
            _, x, y, r = c
            out.append(f'\t(fp_circle (center {n(x)} {n(y)}) (end {n(x + r)} {n(y)}) '
                       f'(stroke (width 0.1) (type dash)) (fill none) (layer "Cmts.User"))')
        elif c[0] == "line":
            _, x0, y0, x1, y1 = c
            out.append(f'\t(fp_line (start {n(x0)} {n(y0)}) (end {n(x1)} {n(y1)}) '
                       f'(stroke (width 0.05) (type dash)) (layer "Cmts.User"))')
        else:
            _, s, x, y = c
            out.append(f'\t(fp_text user "{s}" (at {n(x)} {n(y)} 0) (layer "Cmts.User") {font(0.5)})')
    for p in fp.pads:
        layers = " ".join(f'"{layer}"' for layer in p.layers)
        kind = "thru_hole" if p.drill else "smd"
        line = f'\t(pad "{p.number}" {kind} {p.shape} (at {n(p.x)} {n(p.y)}) (size {n(p.w)} {n(p.h)})'
        if p.drill:
            line += f" (drill {n(p.drill)})"
        line += f" (layers {layers})"
        if p.shape == "roundrect":
            line += f" (roundrect_rratio {n(p.rratio)})"
        if p.mask_margin is not None:
            line += f" (solder_mask_margin {n(p.mask_margin)})"
        if p.drill:
            line += " (zone_connect 2)"
        if p.shape == "custom":
            pts = " ".join(f"(xy {n(x)} {n(y)})" for x, y in p.poly)
            line += (" (options (clearance outline) (anchor rect))"
                     f" (primitives (gr_poly (pts {pts}) (width 0) (fill yes)))")
        out.append(line + ")")
    for name, layers, allowed, pts in fp.keepouts:
        xy = " ".join(f"(xy {n(x)} {n(y)})" for x, y in pts)
        rule = {kind: "allowed" if kind in allowed else "not_allowed" for kind in ("tracks", "vias", "pads")}
        zone_layers = " ".join(f'"{layer}"' for layer in layers)
        out.append(f'\t(zone (net 0) (net_name "") (layers {zone_layers}) (name "{name}") (hatch edge 0.5) '
                   "(connect_pads (clearance 0)) (min_thickness 0.25) (filled_areas_thickness no) "
                   f"(keepout (tracks {rule['tracks']}) (vias {rule['vias']}) (pads {rule['pads']}) (copperpour not_allowed) "
                   f"(footprints allowed)) (fill (thermal_gap 0.5) (thermal_bridge_width 0.5)) (polygon (pts {xy})))")
    if fp.model:
        out.append(f'\t(model "{MODELS}/{fp.model}" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) '
                   f"(rotate (xyz 0 0 {n(fp.model_rotate)})))")
    out.append(")")
    return "\n".join(out) + "\n"


def aperture(x, y, w, h, rratio=0.0) -> Pad:
    """Paste-only aperture (unnumbered pad), when the stencil differs from the copper."""
    return Pad("", "roundrect" if rratio else "rect", x, y, w, h, ("F.Paste",), rratio=rratio)


# ---------------------------------------------------------------------------
# TI TPS22916 (YFP0004, DSBGA-4). SLVSDO5F, p.25 "Example board layout" (4223507/A): pitch 0.4,
# Ø0.23 NSMD copper, mask opening up to 0.05 per side; p.26 stencil: 0.25 square, R0.05, 0.1 mm thick.
# Pins (p.3, table 5-1): A1 VOUT, A2 VIN, B1 GND, B2 ON; top view with A1 top left, A2 to its right.
def yfp0004() -> Footprint:
    balls = {"A1": (-0.2, -0.2), "A2": (0.2, -0.2), "B1": (-0.2, 0.2), "B2": (0.2, 0.2)}
    pads = [Pad(b, "circle", x, y, 0.23, 0.23, ("F.Cu", "F.Mask"), mask_margin=0.05) for b, (x, y) in balls.items()]
    pads += [aperture(x, y, 0.25, 0.25, 0.2) for x, y in balls.values()]
    return Footprint(
        "Texas_YFP0004_DSBGA-4_0.78x0.78mm_Layout2x2_P0.4mm",
        "TI DSBGA-4 YFP0004 (TPS22916), dibujado desde la hoja SLVSDO5F p.25-26 (4223507/A): "
        "bolas de 0,23 mm NSMD, pasta 0,25 mm. Verificar",
        "DSBGA YFP0004 TPS22916", pads, (0.39, 0.39), (0.6, 0.6), (-0.55, -0.55),
        model="DSBGA-4_L0.8-W0.8-H0.5-R2-C2-P0.40-BL.wrl", model_rotate=-90)


# TI TPS25947 / TPS259470A (RPW0010A, VQFN-HR-10, 2 x 2 mm). SLVSFC9C, PDF p.73 "Example board layout"
# (4225183/A 08/2019): IN/OUT 0.30 x 2.40 at x = -/+0.25; side pads 0.60 x 0.25 at (-/+0.90, -/+0.225);
# corner L pads: arm |x| 0.60-1.20, |y| 0.55-0.85 and leg |x| 0.60-0.85, |y| 0.55-1.20; NSMD, mask 0.05.
# Pins (p.5, table 5-1): 1 EN/UVLO, 2 OVLO, 3 AUXOFF, 4 FLT, 5 IN, 6 OUT, 7 DVDT, 8 GND, 9 ILM, 10 ITIMER.
def rpw0010a() -> Footprint:
    # Corner L pads, outline as magnitudes (|x|, |y|) mirrored to each corner. Copper from p.73; the
    # stencil (p.74, 0.1 mm) pulls the outer arm edge and the inner leg edge in by 0.025 (93 %).
    copper_l = [(1.20, 0.55), (0.60, 0.55), (0.60, 1.20), (0.85, 1.20), (0.85, 0.85), (1.20, 0.85)]
    paste_l = [(1.20, 0.55), (0.60, 0.55), (0.60, 1.20), (0.825, 1.20), (0.825, 0.825), (1.20, 0.825)]

    def corner(number, sx, sy, outline, anchor, layers, margin):
        ax, ay = sx * anchor[0], sy * anchor[1]
        poly = [(sx * x - ax, sy * y - ay) for x, y in outline]
        return Pad(number, "custom", ax, ay, 0.2, 0.2, layers, poly=poly, mask_margin=margin)

    copper = ("F.Cu", "F.Mask")
    corners = {"1": (-1, -1), "4": (-1, 1), "7": (1, 1), "10": (1, -1)}
    pads = [corner(num, sx, sy, copper_l, (0.725, 0.70), copper, 0.05) for num, (sx, sy) in corners.items()]
    pads += [Pad(num, "rect", x, y, 0.60, 0.25, mask_margin=0.05)
             for num, x, y in (("2", -0.90, -0.225), ("3", -0.90, 0.225), ("8", 0.90, 0.225), ("9", 0.90, -0.225))]
    pads += [Pad("5", "rect", -0.25, 0, 0.30, 2.40, copper, mask_margin=0.05),
             Pad("6", "rect", 0.25, 0, 0.30, 2.40, copper, mask_margin=0.05)]
    # Paste: IN/OUT as two 0.28 x 1.06 segments at y = -/+0.63 (82 %), corners as the reduced L.
    pads += [aperture(x, y, 0.28, 1.06) for x in (-0.25, 0.25) for y in (-0.63, 0.63)]
    pads += [corner("", sx, sy, paste_l, (0.7125, 0.6875), ("F.Paste",), None) for sx, sy in corners.values()]
    return Footprint(
        "Texas_RPW0010A_VQFN-HR-10_2x2mm_P0.45mm",
        "TI VQFN-HR-10 RPW0010A (TPS259470A), dibujado desde la hoja SLVSFC9C p.73-74 (4225183/A): "
        "pasta de TI (82 % IN/OUT, 93 % esquinas, sin el radio de 0,05 mm). Verificar",
        "VQFN-HR RPW0010A TPS25947 TPS259470", pads, (1.0, 1.0), (1.45, 1.45), (-1.45, -1.35),
        model="VQFN-10_L2.0-W2.0-P0.45-TL.wrl")


# TI TPS63900 (DSK0010A, WSON-10 2.5 x 2.5 mm). SLVSET3D, PDF p.38 "Example board layout" (4218903/C):
# pads 0.60 x 0.25 at x = -/+1.15, pitch 0.5; exposed pad 1.20 x 2.00 with 4 optional Ø0.2 vias at
# (0, -/+0.75) and (-/+0.35, 0); NSMD, mask up to 0.07. p.39 stencil (0.125 mm): pins 0.6 x 0.25,
# exposed pad as two 1.13 x 0.89 apertures (84 %). Pins (p.3, table 5-1): 1 EN, 2 SEL, 3 CFG1, 4 CFG2,
# 5 CFG3, 6 VOUT, 7 LX2, 8 GND, 9 LX1, 10 VIN, thermal pad to GND.
def dsk0010a() -> Footprint:
    pads = []
    for i in range(5):
        y = -1.0 + 0.5 * i
        pads.append(Pad(str(i + 1), "rect", -1.15, y, 0.60, 0.25, mask_margin=0.05))
        pads.append(Pad(str(10 - i), "rect", 1.15, y, 0.60, 0.25, mask_margin=0.05))
    pads.append(Pad("11", "rect", 0, 0, 1.20, 2.00, ("F.Cu", "F.Mask"), mask_margin=0.05))
    pads += [aperture(0, y, 1.13, 0.89) for y in EP_PASTE_Y]
    pads += [Pad("11", "circle", x, y, 0.5, 0.5, ("*.Cu",), drill=0.2) for x, y in ((0, -0.75), (-0.35, 0), (0.35, 0), (0, 0.75))]
    return Footprint(
        "Texas_DSK0010A_WSON-10-1EP_2.5x2.5mm_P0.5mm_EP1.2x2mm_ThermalVias",
        "TI WSON-10 DSK0010A (TPS63900), dibujado desde la hoja SLVSET3D p.38-39 (4218903/C), "
        "con las 4 vías del pad expuesto. Verificar",
        "WSON DSK0010A TPS63900", pads, (1.25, 1.25), (1.7, 1.5), (-1.65, -1.45),
        model="WSON-10_L2.5-W2.5-W0.50-TL-EP.wrl")


EP_PASTE_Y = (-0.545, 0.545)  # centres of the two 1.13 x 0.89 apertures (p.39, measured)


# Dock pads: our own design (B-909), see docs/hardware/pod-v0.md ("Conexión externa") and
# pod-mecanica-produccion.md. Five flat gold pads, Ø2.0 mm on a 3.0 mm pitch, no paste (they are not
# soldered). The key: the pad row sits 4 mm below the axis of the two magnets (22 mm apart, opposite
# polarity), so a pod turned 180° would put the base's springs 8 mm away from the pads, and its magnets
# repel. Physical order VBUS, GND, D+, D-, DETECT: GND between VBUS and the data pair. Finish: selective
# electroplated hard gold of 0.5 um or more on these pads (fab note). The base's springs make in this order:
# GND longest (first to make, last to break), then VBUS, D+ and D-, and DETECT shortest (VBUS only once the
# pod is seated). The Hall sensor goes 15 mm or more from either magnet: a D5 x 2 mm N35 magnet still gives
# about 4.8 mT (the DRV5032FB maximum operate point) at roughly 9-10 mm on its axis. To confirm with the base
# (spring tip, tolerance, magnet size).
def dock_pads() -> Footprint:
    order = [("1", "VBUS"), ("4", "GND"), ("2", "D+"), ("3", "D-"), ("5", "DET")]
    pads = [Pad(num, "circle", -6 + 3 * i, 0, 2.0, 2.0, ("F.Cu", "F.Mask")) for i, (num, _) in enumerate(order)]
    return Footprint(
        "Pod_Dock_Pads_5P_D2.0mm_P3.0mm_Keyed",
        "Diseño propio (B-909): 5 pads planos dorados del pod para los resortes pogo de la base "
        "(VBUS, D+, D-, GND, DETECT). Llave: fila de pads 4 mm por debajo del eje de dos imanes de polaridad "
        "opuesta; girado 180 grados, los resortes caen a 8 mm de los pads y los imanes se repelen. Sin pasta. "
        "Oro duro electrolítico selectivo de 0,5 um o más. Hall a 15 mm o más de cada imán. Medidas a confirmar con la base",
        "pogo dock base pads llave pod", pads, (7.25, 1.25), (7.5, 1.5), (-7.9, 0),
        attr="exclude_from_pos_files exclude_from_bom",
        fab_texts=[(label, -6 + 3 * i, 1.6, 0.4) for i, (_, label) in enumerate(order)],
        comments=[("circle", -11, -4, 2.5), ("circle", 11, -4, 2.5), ("line", -11, -4, 11, -4),
                  ("text", "Imán N, D5 mm, en la tapa", -11, -7), ("text", "Imán S, D5 mm, en la tapa", 11, -7),
                  ("text", "Eje de los imanes 4 mm sobre los pads (llave)", 0, -4.6),
                  ("circle", -11, -4, 15), ("circle", 11, -4, 15),
                  ("text", "Hall DRV5032 fuera de los círculos: 15 mm o más de cada imán", 0, -8.6),
                  ("text", "Oro duro electrolítico selectivo, 0,5 um o más", 0, 3.0),
                  ("text", "Resortes de la base: GND el más largo, DETECT el más corto", 0, 3.8)])


# Quectel LC29H (AA, EA and the rest of the series), LCC-24, 12.2 x 16.0 mm (H2.7 mm in Quectel's part).
# From Quectel's official footprint, "LC29H(AA,AI,BA,CA,DA,EA,TI) Footprint&Part V1.4" (2026-07-03, Altium
# PcbDoc), through the numeric table datos/Quectel_LC29H_Footprint_V1.4.csv (altium_pads.py; the vendor file
# is not committed). Pads 2.5 x 0.8 obround ("round" in Altium) at x = -/+6.10, pitch 1.1, pin 1 at
# y = -7.0, 3.0 mm gap between pins 7/8 and 17/18; solder mask 0.05 mm per pad (manual in the pad), paste
# equal to the copper (rule of 0). Courtyard: Quectel's 15.1 x 16.4 mm boundary (Mechanical 5); silkscreen
# as Quectel's: body top and bottom edges, corner ticks and the pin 1 triangle outside the body. The same
# land pattern as the Hardware Design V1.3 and V1.4, figure 19 (p.47 and p.46), from which it was first drawn;
# 3 mm from other parts (section 5.3).
LC29H_TABLE = DATA / "Quectel_LC29H_Footprint_V1.4.csv"
LC29H_SILK = [(-6.1, -8.0, 6.1, -8.0), (-6.1, 8.0, 6.1, 8.0),
              (-6.1, -7.75, -6.1, -8.0), (6.1, -7.75, 6.1, -8.0), (-6.1, 8.0, -6.1, 7.75), (6.1, 8.0, 6.1, 7.75),
              (-8.1035, -6.6465, -8.1035, -7.3536), (-8.1035, -7.3536, -7.75, -7.0), (-8.1035, -6.6465, -7.75, -7.0)]


def vendor_pads(path: Path) -> list:
    """Pads from a table written by altium_pads.py (top-layer SMD, "round" = obround, paste = copper)."""
    shapes = {"round": "oval", "rect": "rect"}
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if not line.startswith("#")]
    pads = []
    for row in csv.DictReader(lines):
        if row["layer"] != "top" or float(row["hole_mm"]) or float(row["rotation_deg"]) or float(row["paste_margin_mm"]):
            raise ValueError(f"{path.name}: pad {row['pad']} fuera de lo soportado")
        pads.append(Pad(row["pad"], shapes[row["shape"]], float(row["x_mm"]), float(row["y_mm"]),
                        float(row["w_mm"]), float(row["h_mm"]), mask_margin=float(row["mask_margin_mm"])))
    return pads


def lc29h() -> Footprint:
    return Footprint(
        "Quectel_LC29H_LCC-24_12.2x16.0mm_P1.1mm",
        "Quectel LC29H (todas las variantes), desde el footprint oficial de Quectel (Footprint&Part V1.4, "
        "2026-07-03): pads ovalados de 2,5 x 0,8 mm, paso 1,1, máscara de 0,05 mm. Verificado",
        "Quectel LC29H GNSS L1 L5 LCC", vendor_pads(LC29H_TABLE), (6.1, 8.0), (7.55, 8.2), None,
        model="GPSM-SMD_24P-L16.0-W12.2-P1.10-TL.wrl", model_rotate=270,
        silk=[(*line, 0.1) for line in LC29H_SILK],
        comments=[("text", "3 mm libres a otras partes (Quectel 5.3)", 0, 8.85)])


# Qorvo DWM3000 (13.0 x 22.7 mm, 24 pads). Data sheet Rev B (May 2021), figure 14 "land pattern"
# (p.22), figure 13 (p.21) and section 6.1, figure 10 (p.19); the bottom-row offset (pin 8 centre to the
# bottom row, 2.30 mm) from Qorvo's land pattern drawing on forum.qorvo.com ("DWS3000 Land Pattern").
# Pads 2.45 x 1.00, pitch 1.40, side rows 0.20 inside the long edges, bottom row 0.20 inside the bottom
# edge. The antenna part (9.775 mm beyond the ground boundary, 12.925 mm above the bottom edge) has no
# metal on any layer; Qorvo also asks for about 10 mm without metal on each side of it (figure 10).
def dwm3000() -> Footprint:
    side = [-6.15 + 1.4 * i for i in range(8)]  # pins 1-8, top down
    pads = [Pad(str(i + 1), "rect", -6.30, y, 2.45, 1.00) for i, y in enumerate(side)]
    pads += [Pad(str(9 + i), "rect", -4.9 + 1.4 * i, 5.95, 1.00, 2.45) for i in range(8)]
    pads += [Pad(str(24 - i), "rect", 6.30, y, 2.45, 1.00) for i, y in enumerate(side)]
    bottom, top = 6.15, 6.15 - 22.7
    ground = bottom - 12.925
    return Footprint(
        "Qorvo_DWM3000",
        "Qorvo DWM3000, dibujado desde la hoja Rev B (figuras 13 y 14) y el land pattern del foro de Qorvo, "
        "con el keep-out de la antena en todas las capas. Verificar",
        "Qorvo DWM3000 UWB", pads, (6.5, 11.35), (7.55, 12.125), (-7.9, -6.15),
        body_y=-5.2, courtyard_y=-4.675, keepouts=[("DWM3000_ANTENA", ("*.Cu",), (), [(-6.5, top), (6.5, top), (6.5, ground), (-6.5, ground)])],
        comments=[("line", -16.5, ground, 16.5, ground),
                  ("text", "Sin metal a los lados de la antena: unos 10 mm (Qorvo 6.1)", 0, top - 1),
                  ("text", "Límite de tierra", 0, ground + 0.6)])


# Analog Devices ADXL372 (CC-16-4, LGA-16, 3.25 x 3.00 x 1.06 mm). Data sheet Rev. B, figure 54
# "Recommended PWB land pattern" (p.55) and figure 55 (outline, p.56): side lands 0.925 x 0.30 at
# x = -/+1.2875 (pins 1-5 down the left, 9-13 up the right), top and bottom lands 0.30 x 0.80 at
# y = -/+1.275 (6-8 left to right along the bottom, 14-16 right to left along the top), pitch 0.5.
def adxl372() -> Footprint:
    rows = [-1.0 + 0.5 * i for i in range(5)]
    pads = [Pad(str(1 + i), "rect", -1.2875, y, 0.925, 0.30) for i, y in enumerate(rows)]
    pads += [Pad(str(6 + i), "rect", -0.5 + 0.5 * i, 1.275, 0.30, 0.80) for i in range(3)]
    pads += [Pad(str(13 - i), "rect", 1.2875, y, 0.925, 0.30) for i, y in enumerate(rows)]
    pads += [Pad(str(16 - i), "rect", -0.5 + 0.5 * i, -1.275, 0.30, 0.80) for i in range(3)]
    return Footprint(
        "Analog_CC-16-4_LGA-16_3.25x3mm_P0.5mm",
        "ADI LGA-16 CC-16-4 (ADXL372), dibujado desde la hoja Rev. B, figura 54 (p.55). Verificar",
        "LGA-16 CC-16-4 ADXL372", pads, (1.625, 1.5), (2.0, 1.95), (-1.95, -1.45),
        model="LGA-16_L3.3-W3.0-H1.1-P0.50-TL.wrl")


# Qualcomm RF360 B39162B8389P810 (dual-band L1 + L5 SAW, 1.4 x 1.1 mm, 5 pads). Data sheet p.5, figure 2
# "Land pattern" (thru view, numbered like the top view on the same page): five lands 0.30 x 0.375,
# pad 1 (IN) at (-0.50, 0), 5 and 4 (GND, OUT) along the top, 2 and 3 (GND) along the bottom, rows at
# y = -/+0.2875 (from the printed 0.1 to the body edge). No mask or stencil data: mask 0.05, paste = copper.
def b8389() -> Footprint:
    lands = {"1": (-0.5, 0), "5": (0, -0.2875), "4": (0.5, -0.2875), "2": (0, 0.2875), "3": (0.5, 0.2875)}
    pads = [Pad(num, "rect", x, y, 0.30, 0.375, mask_margin=0.05) for num, (x, y) in lands.items()]
    return Footprint(
        "Qualcomm_B39162B8389P810_1.4x1.1mm",
        "SAW L1 + L5 Qualcomm RF360 B39162B8389P810, dibujado desde la hoja (p.5, figura 2). Verificar",
        "SAW GNSS L1 L5 B8389", pads, (0.7, 0.55), (0.95, 0.85), (-0.95, -0.4),
        model="FILTER-SMD_5P-L1.4-W1.1_RSFPXXXXD.wrl")


# Infineon BGA525N6 (PG-TSNP-6-10, 1.1 x 0.7 mm). Data sheet v1.2, figure 4 "Footprint recommendation"
# (PDF p.13): six 0.25 x 0.25 copper lands at 0.4 pitch, rows at y = -/+0.2, Ø0.25 paste apertures;
# NSMD mask openings of about 0.35 (measured on the figure, with an optional mask dam). Top view with
# pin 1 at the lower left: 1 GND, 2 VCC, 3 AO along the bottom, 4 CTRL2, 5 AI, 6 CTRL1 along the top.
def bga525n6() -> Footprint:
    lands = {"1": (-0.4, 0.2), "2": (0, 0.2), "3": (0.4, 0.2), "4": (0.4, -0.2), "5": (0, -0.2), "6": (-0.4, -0.2)}
    pads = [Pad(num, "rect", x, y, 0.25, 0.25, ("F.Cu", "F.Mask"), mask_margin=0.05) for num, (x, y) in lands.items()]
    pads += [Pad("", "circle", x, y, 0.25, 0.25, ("F.Paste",)) for x, y in lands.values()]
    return Footprint(
        "Infineon_PG-TSNP-6-10_1.1x0.7mm_P0.4mm",
        "Infineon PG-TSNP-6-10 (BGA525N6), dibujado desde la hoja v1.2, figura 4 (PDF p.13). Verificar",
        "TSNP-6 BGA525N6 LNA GNSS", pads, (0.55, 0.35), (0.8, 0.6), (-0.7, 0.55),
        model="TSNP-6_L1.1-W0.7-H0.4-P0.40-BL.wrl")


# Taoglas GVLB208.A (passive stacked L1 + L5 patch, 20 x 20 x 8.8 mm, one Ø0.8 pin). Data sheet,
# section 3 (p.6, drawing: pin 1.2 mm from the centre, towards the side opposite the chamfered corner)
# and section 4.3 "Copper clearance" (p.10): plated hole Ø1.0, top pad Ø1.2 with Ø3.0 without copper on
# the top and the inner layers, bottom pad Ø2.2 with Ø3.5 without copper on the bottom. Origin at the pin.
# The clearances are keep-outs for pours, tracks and vias (the pin's own pad stays allowed). The feed
# leaves on B.Cu from the Ø2.2 pad (the ceramic covers the top and its ground), so the bottom one has to
# let that one track through: KiCad keep-outs cannot filter by net, so on B.Cu only tracks are allowed and
# the RF_50 rules keep other nets 0.5 mm from the feed (hardware/README.md).
def gvlb208() -> Footprint:
    def circle(r, steps=24):
        return [(r * math.cos(2 * math.pi * k / steps), r * math.sin(2 * math.pi * k / steps)) for k in range(steps)]
    pads = [Pad("1", "circle", 0, 0, 1.2, 1.2, ("*.Cu", "*.Mask"), drill=1.0),
            Pad("1", "circle", 0, 0, 2.2, 2.2, ("B.Cu", "B.Mask"))]
    return Footprint(
        "Taoglas_GVLB208.A_20x20mm",
        "Patch pasivo L1 + L5 Taoglas GVLB208.A, dibujado desde la hoja (secciones 3 y 4.3). Pide un plano de "
        "tierra de 70 x 70 mm. Verificar",
        "antena patch GNSS L1 L5 Taoglas GVLB208", pads, (10, 10), (10.25, 10.25), (8.5, -10.5),
        attr="through_hole", body_y=-1.2, courtyard_y=-1.2,
        keepouts=[("GVLB208_DESPEJE_SUP", ("F.Cu", "In1.Cu", "In2.Cu"), ("pads",), circle(1.5)),
                  ("GVLB208_DESPEJE_INF", ("B.Cu",), ("pads", "tracks"), circle(1.75))],
        comments=[("text", "Esquina chaflanada arriba a la derecha", 0, -8.5),
                  ("text", "Plano de tierra recomendado 70 x 70 mm", 0, 6),
                  ("text", "Alimentación por B.Cu desde el pad de 2,2 mm; nunca DC", 0, 7)])


FOOTPRINTS = [yfp0004, rpw0010a, dsk0010a, dock_pads, lc29h, dwm3000, adxl372, b8389, bga525n6, gvlb208]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="no escribe: falla si algún archivo cambiaría")
    args = parser.parse_args()
    stale = []
    for build in FOOTPRINTS:
        fp = build()
        path = LIB / f"{fp.name}.kicad_mod"
        text = render(fp)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            stale.append(path.name)
            if not args.check:
                path.write_text(text, encoding="utf-8")
    if args.check and stale:
        print("Desactualizados (correr footprints_hoja.py):", ", ".join(stale))
        return 1
    print("Footprints al día." if args.check else f"Escritos: {len(stale)} archivos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
