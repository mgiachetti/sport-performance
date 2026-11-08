"""Pad table of an Altium PcbDoc footprint, as CSV in mm (KiCad axes: origin at the component, Y down).

Used once to turn Quectel's official LC29H footprint (Footprint&Part V1.4) into
hardware/tools/datos/Quectel_LC29H_Footprint_V1.4.csv; the vendor file is not committed (see
hardware/lib/README.md). It reads the OLE streams Components6, Pads6, Tracks6 and Rules6 with the same
record layout as KiCad's Altium importer (pcbnew/pcb_io/altium/altium_parser_pcb.cpp) and only reads:
nothing in the file is executed. Single top-layer SMD footprints only (what the vendor zips contain).

Needs olefile (pinned), in a throwaway venv like hardware/lib/generar.sh; run it with -I from outside the
folder that holds the vendor files:

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install olefile==0.47
    /tmp/venv/bin/python -I hardware/tools/altium_pads.py <footprint.PcbDoc> > table.csv
"""

from __future__ import annotations

import hashlib
import re
import struct
import sys
from pathlib import Path

import olefile

UNIT_MM = 0.0254 / 10000  # Altium's internal unit is 1/10000 mil
SHAPES = {1: "round", 2: "rect", 3: "octagonal"}  # ALTIUM_PAD_SHAPE; "round" with w != h is an obround
MODES = {0: "none", 1: "rule", 2: "manual"}  # ALTIUM_MODE of the paste and mask expansions
LAYERS = {1: "top", 33: "top_overlay", 61: "mechanical5"}


def mil(text: str) -> float:
    return float(text.removesuffix("mil")) * 0.0254


def mm(v: float) -> str:
    text = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def records_props(buf: bytes) -> list:
    out, i = [], 0
    while i + 4 <= len(buf):
        n = struct.unpack_from("<I", buf, i)[0]
        i += 4
        text = buf[i:i + n].rstrip(b"\0").decode("latin1")
        i += n
        out.append(dict(kv.split("=", 1) for kv in text.split("|") if "=" in kv))
    return out


def rules(buf: bytes) -> dict:
    found = {}
    for chunk in re.split(r"[\x00-\x08]+", buf.decode("latin1")):
        if "RULEKIND=" in chunk:
            d = dict(kv.split("=", 1) for kv in chunk.split("|") if "=" in kv)
            if "EXPANSION" in d:
                found[d["RULEKIND"]] = mil(d["EXPANSION"])
    return found


def main(path: str) -> int:
    ole = olefile.OleFileIO(path)
    comps = records_props(ole.openstream("Components6/Data").read())
    if len(comps) != 1 or float(comps[0]["ROTATION"]) != 0:
        sys.exit("se espera un solo componente sin rotar")
    ox, oy = mil(comps[0]["X"]) / UNIT_MM, mil(comps[0]["Y"]) / UNIT_MM  # component origin, internal units
    rule = rules(ole.openstream("Rules6/Data").read())
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    print(f"# source: {Path(path).name} (sha256 {digest}), read by hardware/tools/altium_pads.py")
    print(f"# {comps[0]['PATTERN']}: {comps[0].get('FOOTPRINTDESCRIPTION', '')}; height {mm(mil(comps[0]['HEIGHT']))} mm")
    print(f"# rules: paste {mm(rule.get('PasteMaskExpansion', 0))}, mask {mm(rule.get('SolderMaskExpansion', 0))}")
    print("pad,layer,shape,x_mm,y_mm,w_mm,h_mm,rotation_deg,hole_mm,paste_margin_mm,mask_margin_mm")
    buf, i, rows = ole.openstream("Pads6/Data").read(), 0, []
    while i < len(buf):
        if buf[i] != 2:
            sys.exit(f"registro de pad inesperado en {i}")
        i += 1
        sub = []
        for _ in range(6):
            n = struct.unpack_from("<I", buf, i)[0]
            i += 4
            sub.append(buf[i:i + n])
            i += n
        name = sub[0][1:1 + sub[0][0]].decode("latin1")
        r = sub[4]
        x, y, w, h = struct.unpack_from("<4i", r, 13)
        hole = struct.unpack_from("<i", r, 45)[0]
        rot = struct.unpack_from("<d", r, 52)[0]
        paste_v, mask_v = struct.unpack_from("<ii", r, 86)
        paste_mode, mask_mode = MODES[r[101]], MODES[r[102]]
        paste = paste_v * UNIT_MM if paste_mode == "manual" else rule.get("PasteMaskExpansion", 0)
        mask = mask_v * UNIT_MM if mask_mode == "manual" else rule.get("SolderMaskExpansion", 0)
        rows.append((int(name) if name.isdigit() else name, ",".join([
            name, LAYERS.get(r[0], str(r[0])), SHAPES.get(r[49], str(r[49])),
            mm((x - ox) * UNIT_MM), mm(-(y - oy) * UNIT_MM), mm(w * UNIT_MM), mm(h * UNIT_MM),
            mm(rot), mm(hole * UNIT_MM), mm(paste), mm(mask)])))
    for _, row in sorted(rows):
        print(row)
    # Lines (silkscreen, courtyard), as comments: layer, start and end, width.
    buf, i = ole.openstream("Tracks6/Data").read(), 0
    while i < len(buf):
        i += 1
        n = struct.unpack_from("<I", buf, i)[0]
        i += 4
        r = buf[i:i + n]
        i += n
        x0, y0, x1, y1, width = struct.unpack_from("<5i", r, 13)
        pts = [mm((x0 - ox) * UNIT_MM), mm(-(y0 - oy) * UNIT_MM), mm((x1 - ox) * UNIT_MM), mm(-(y1 - oy) * UNIT_MM)]
        print(f"# line {LAYERS.get(r[0], r[0])} ({pts[0]}, {pts[1]}) ({pts[2]}, {pts[3]}) width {mm(width * UNIT_MM)}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
