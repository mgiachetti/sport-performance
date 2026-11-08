#!/usr/bin/env python3
"""Generate the pod v0 hierarchical schematic from ``diseno.py`` (standard library only).

Usage (from any folder):

    python3 hardware/tools/esquematico/generar.py           # write library and sheets
    python3 hardware/tools/esquematico/generar.py --check   # fail if the files are out of date

What it writes:

* ``hardware/lib/pod.kicad_sym``: the easyeda2kicad symbols with their pin electrical types set
  (``simbolos.EASYEDA_PIN_TYPES``) plus the generic, IC and power symbols of ``simbolos.py``.
* ``hardware/pod-v0/<sheet>.kicad_sch`` for each sheet of ``diseno.SHEETS``: every part with its
  fields, a short wire stub on each pin ending in a label (local, or global when the net crosses
  sheets), a power symbol (rails of ``simbolos.POWER_NETS``) or a no-connect marker.

The root sheet (``pod-v0.kicad_sch``) and the board are not touched. UUIDs are derived from the
content (uuid5), so regenerating an unchanged design gives identical files.
"""

from __future__ import annotations

import argparse
import math
import sys
import uuid
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import diseno  # noqa: E402
import simbolos  # noqa: E402
from modelo import NC, Part  # noqa: E402
from sexpr import Str, dump, find, find_all, parse  # noqa: E402

REPO = HERE.parents[2]
LIB_PATH = REPO / "hardware" / "lib" / "pod.kicad_sym"
PROJECT_DIR = REPO / "hardware" / "pod-v0"
PROJECT = "pod-v0"
LIB = "pod"
DATE = "2026-11-08"
NAMESPACE = uuid.UUID("5b0f6a52-7f38-4d0e-9a51-0b2c8f9e4d10")

GRID = 1.27
STUB = 2.54
CHAR_W = 1.1
PAPERS = [("A3", 420, 297), ("A2", 594, 420), ("A1", 841, 594)]
MARGIN = 15.24
TITLE_BLOCK_H = 40.64
GAP = 5.08


def uid(*parts: str) -> Str:
    return Str(str(uuid.uuid5(NAMESPACE, "/".join(parts))))


def snap(value: float, step: float = 2.54) -> float:
    return math.ceil(round(value / step, 6)) * step


n = simbolos.num


# ---------------------------------------------------------------------------
# Library


def build_library() -> tuple[list, dict]:
    """Return the library node and {symbol name: symbol node}."""
    lib = parse(LIB_PATH.read_text(encoding="utf-8"))
    owned = {s[1]: s for s in simbolos.owned_symbols()}
    easyeda = []
    for sym in find_all(lib, "symbol"):
        props = {p[1]: p[2] for p in find_all(sym, "property")}
        if props.get("Generador") == simbolos.GENERATOR_TAG or sym[1] in owned:
            continue
        types = simbolos.EASYEDA_PIN_TYPES.get(sym[1])
        if types is None:
            raise SystemExit(f"pod.kicad_sym: no hay tipos de pin para {sym[1]} en simbolos.EASYEDA_PIN_TYPES")
        for p in iter_pins(sym):
            number = find(p, "number")[1]
            kind = types.get(number, types.get("*"))
            if kind is None:
                raise SystemExit(f"{sym[1]}: falta el tipo del pin {number}")
            p[1] = kind
        easyeda.append(sym)
    header = [x for x in lib if not (isinstance(x, list) and x and x[0] == "symbol")]
    symbols = sorted(easyeda + list(owned.values()), key=lambda s: s[1])
    node = header + symbols
    return node, {s[1]: s for s in symbols}


def iter_pins(sym: list):
    for unit in find_all(sym, "symbol"):
        for p in find_all(unit, "pin"):
            yield p


def pin_table(sym: list) -> dict:
    """{number: (x, y, angle, type, name)} in library coordinates (y up)."""
    pins = {}
    for p in iter_pins(sym):
        at = find(p, "at")
        number = str(find(p, "number")[1])
        pins[number] = (float(at[1]), float(at[2]), int(float(at[3])), p[1], str(find(p, "name")[1]))
    return pins


def body_box(sym: list) -> tuple[float, float, float, float]:
    """Bounding box of graphics and pins, in sheet coordinates (y down) relative to the origin."""
    xs, ys = [0.0], [0.0]
    for unit in find_all(sym, "symbol"):
        for item in unit:
            if not isinstance(item, list):
                continue
            if item[0] == "rectangle":
                for key in ("start", "end"):
                    pt = find(item, key)
                    xs.append(float(pt[1]))
                    ys.append(-float(pt[2]))
            elif item[0] == "polyline":
                for pt in find_all(find(item, "pts"), "xy"):
                    xs.append(float(pt[1]))
                    ys.append(-float(pt[2]))
            elif item[0] == "circle":
                c = find(item, "center")
                r = float(find(item, "radius")[1])
                xs += [float(c[1]) - r, float(c[1]) + r]
                ys += [-float(c[2]) - r, -float(c[2]) + r]
            elif item[0] == "pin":
                at = find(item, "at")
                xs.append(float(at[1]))
                ys.append(-float(at[2]))
    return min(xs), min(ys), max(xs), max(ys)


def lib_prop(sym: list, name: str):
    for p in find_all(sym, "property"):
        if p[1] == name:
            return p
    return None


# ---------------------------------------------------------------------------
# Design checks


class Design:
    def __init__(self, sheets, symbols):
        self.sheets = sheets
        self.symbols = symbols
        self.net_sheets = defaultdict(set)
        self.net_pins = defaultdict(list)  # net -> [(sheet, ref, pin, type, dnp, kind)]
        self.errors = []
        self.assign_refs()
        self.collect()

    def assign_refs(self):
        for sheet in self.sheets:
            counters = defaultdict(int)
            for group in sheet.groups:
                for p in group.parts:
                    if p.kind == "flag":
                        continue
                    prefix = str(lib_prop(self.symbols[p.symbol], "Reference")[2])
                    counters[prefix] += 1
                    p.ref = f"{prefix}{sheet.base + counters[prefix]}"

    def collect(self):
        for sheet in self.sheets:
            for group in sheet.groups:
                for p in group.parts:
                    if p.kind == "flag":
                        net = p.nets["1"]
                        self.net_sheets[net].add(sheet.name)
                        self.net_pins[net].append((sheet.name, "#FLG", "1", "power_out", False, "flag"))
                        continue
                    sym = self.symbols.get(p.symbol)
                    if sym is None:
                        self.errors.append(f"{p.ref}: no existe el símbolo {p.symbol}")
                        continue
                    pins = pin_table(sym)
                    missing = set(pins) - set(p.nets)
                    extra = set(p.nets) - set(pins)
                    if missing:
                        self.errors.append(f"{sheet.name} {p.ref} ({p.symbol}): pines sin asignar {sorted(missing)}")
                    if extra:
                        self.errors.append(f"{sheet.name} {p.ref} ({p.symbol}): pines que no existen {sorted(extra)}")
                    for number, net in p.nets.items():
                        if net == NC or number not in pins:
                            continue
                        kind = pins[number][3]
                        if kind == "no_connect":
                            self.errors.append(f"{p.ref} pin {number}: es no_connect y se conectó a {net}")
                        if kind == "unspecified":
                            self.errors.append(f"{p.ref} pin {number}: tipo unspecified")
                        self.net_sheets[net].add(sheet.name)
                        self.net_pins[net].append((sheet.name, p.ref, number, kind, p.dnp, "part"))

    def check(self):
        power = set(simbolos.POWER_NETS)
        for net, pins in sorted(self.net_pins.items()):
            parts = [x for x in pins if x[5] == "part"]
            if net not in power and len(parts) < 2:
                self.errors.append(f"red {net}: un solo pin ({parts})")
            outs = [x for x in pins if x[3] == "power_out"]
            ins = [x for x in pins if x[3] == "power_in"] + ([("sym",)] if net in power else [])
            if len(outs) > 1:
                self.errors.append(f"red {net}: más de una salida de potencia {outs}")
            if ins and not outs:
                self.errors.append(f"red {net}: entradas de potencia sin fuente (falta PWR_FLAG)")
            for x in outs:
                if x[4]:
                    self.errors.append(f"red {net}: la fuente {x[1]} está sin montar")
        if self.errors:
            raise SystemExit("Errores en diseno.py:\n  " + "\n  ".join(self.errors))

    def label_kind(self, net: str) -> str:
        if net in simbolos.POWER_NETS:
            return "power"
        return "global" if len(self.net_sheets[net]) > 1 else "local"


# ---------------------------------------------------------------------------
# Sheet writer


SHAPES = {"input": "input", "output": "output", "tri_state": "tri_state", "open_collector": "output",
          "bidirectional": "bidirectional", "passive": "passive", "power_in": "passive", "power_out": "passive"}


def term_width(kind: str, net: str) -> float:
    if kind == "power":
        return 3.81 if net == "GND" else len(net) * CHAR_W + 4.5
    if kind == "global":
        return len(net) * CHAR_W + 4.5
    return len(net) * CHAR_W + 1.0


def rot_offset(lx: float, ly: float, rot: int) -> tuple[float, float]:
    """Library offset to sheet offset for a symbol rotated ``rot`` degrees (counter-clockwise)."""
    sx, sy = lx, -ly
    for _ in range(rot // 90):
        sx, sy = sy, -sx
    return sx, sy


class SheetWriter:
    def __init__(self, sheet, design, symbols, root_uuid, sheet_uuid, file_uuid):
        self.sheet = sheet
        self.design = design
        self.symbols = symbols
        self.path = f"/{root_uuid}/{sheet_uuid}"
        self.file_uuid = file_uuid
        self.items = []
        self.used = set()
        self.pwr = 0
        self.flg = 0

    # -- primitives ---------------------------------------------------------
    def key(self, *parts):
        return uid(self.sheet.name, *parts)

    def wire(self, x1, y1, x2, y2, key):
        self.items.append(["wire", ["pts", ["xy", n(x1), n(y1)], ["xy", n(x2), n(y2)]],
                           ["stroke", ["width", "0"], ["type", "default"]], ["uuid", self.key("w", key)]])

    def no_connect(self, x, y, key):
        self.items.append(["no_connect", ["at", n(x), n(y)], ["uuid", self.key("nc", key)]])

    def text(self, value, x, y, key, size=1.27):
        self.items.append(["text", Str(value), ["exclude_from_sim", "no"], ["at", n(x), n(y), "0"],
                           ["effects", ["font", ["size", n(size), n(size)]], ["justify", "left", "bottom"]],
                           ["uuid", self.key("t", key)]])

    def rectangle(self, x1, y1, x2, y2, key):
        self.items.append(["rectangle", ["start", n(x1), n(y1)], ["end", n(x2), n(y2)],
                           ["stroke", ["width", "0"], ["type", "dash"]], ["fill", ["type", "none"]], ["uuid", self.key("r", key)]])

    def label(self, net, x, y, right, key, pin_type):
        kind = self.design.label_kind(net)
        angle = "0" if right else "180"
        justify = ["justify", "left" if right else "right", "bottom"]
        if kind == "local":
            self.items.append(["label", Str(net), ["at", n(x), n(y), angle], ["fields_autoplaced", "yes"],
                               ["effects", simbolos.FONT, justify], ["uuid", self.key("l", key)]])
        else:
            shape = SHAPES.get(pin_type, "bidirectional")
            refs_x = x + (len(net) * CHAR_W + 4) * (1 if right else -1)
            self.items.append(["global_label", Str(net), ["shape", shape], ["at", n(x), n(y), angle], ["fields_autoplaced", "yes"],
                               ["effects", simbolos.FONT, ["justify", "left" if right else "right"]], ["uuid", self.key("g", key)],
                               ["property", Str("Intersheetrefs"), Str("${INTERSHEET_REFS}"), ["at", n(refs_x), n(y), "0"],
                                ["effects", simbolos.FONT, ["justify", "left" if right else "right"], "hide"]]])

    def power_symbol(self, name, x, y, right, key, flag=False):
        lib_name = "PWR_FLAG" if flag else name
        sym = self.symbols[lib_name]
        self.used.add(lib_name)
        if flag:
            self.flg += 1
            ref = f"#FLG{self.sheet.base + self.flg}"
        else:
            self.pwr += 1
            ref = f"#PWR{self.sheet.base + self.pwr:03d}" if self.sheet.base < 100 else f"#PWR{self.sheet.base * 10 + self.pwr}"
        tip_down = name == "GND" and not flag
        # Rotate so the symbol points along the stub (away from the part).
        if tip_down:
            rot = 90 if right else 270
        else:
            rot = 270 if right else 90
        vx, vy = rot_offset(*[float(v) for v in find(lib_prop(sym, "Value"), "at")[1:3]], rot)
        value_hidden = "hide" in find(lib_prop(sym, "Value"), "effects")
        just = ["justify", "left" if right else "right"]
        value_eff = ["effects", simbolos.FONT, just] + (["hide"] if value_hidden else [])
        node = ["symbol", ["lib_id", Str(f"{LIB}:{lib_name}")], ["at", n(x), n(y), str(rot)], ["unit", "1"],
                ["exclude_from_sim", "no"], ["in_bom", "yes"], ["on_board", "yes"], ["dnp", "no"],
                ["uuid", self.key("p", key)],
                ["property", Str("Reference"), Str(ref), ["at", n(x), n(y), "0"], ["effects", simbolos.FONT, "hide"]],
                ["property", Str("Value"), Str(name if not flag else "PWR_FLAG"), ["at", n(x + vx), n(y + vy), "0"], value_eff],
                ["property", Str("Footprint"), Str(""), ["at", n(x), n(y), "0"], ["effects", simbolos.FONT, "hide"]],
                ["property", Str("Datasheet"), Str(""), ["at", n(x), n(y), "0"], ["effects", simbolos.FONT, "hide"]],
                ["pin", Str("1"), ["uuid", self.key("pp", key)]],
                ["instances", ["project", Str(PROJECT), ["path", Str(self.path), ["reference", Str(ref)], ["unit", "1"]]]]]
        self.items.append(node)

    def terminal(self, net, x, y, right, key, pin_type):
        if self.design.label_kind(net) == "power":
            self.power_symbol(net, x, y, right, key)
        else:
            self.label(net, x, y, right, key, pin_type)

    # -- blocks -------------------------------------------------------------
    def part_extent(self, p: Part):
        """Bounding box (relative to the symbol origin, sheet coordinates) of a part and its terminals."""
        if p.kind == "flag":
            net = p.nets["1"]
            w = term_width(self.design.label_kind(net), net)
            return (-w, -2.54, 5.08 + 12.0, 2.54)
        sym = self.symbols[p.symbol]
        x1, y1, x2, y2 = body_box(sym)
        pins = pin_table(sym)
        for number, (px, py, angle, kind, _name) in pins.items():
            net = p.nets.get(number, NC)
            if net == NC:
                continue
            w = STUB + term_width(self.design.label_kind(net), net)
            if angle == 0:
                x1 = min(x1, px - w)
            else:
                x2 = max(x2, px + w)
        return (x1 - 1.27, y1 - 3.81, x2 + 1.27, y2 + 3.81)

    def place_part(self, p: Part, ox: float, oy: float):
        if p.kind == "flag":
            net = p.nets["1"]
            self.terminal(net, ox, oy, False, f"flag/{net}/net", "power_out")
            self.wire(ox, oy, ox + 5.08, oy, f"flag/{net}")
            self.power_symbol("PWR_FLAG", ox + 5.08, oy, True, f"flag/{net}/flg", flag=True)
            return
        sym = self.symbols[p.symbol]
        self.used.add(p.symbol)
        pins = pin_table(sym)
        two_pin = len(pins) <= 2 and p.symbol not in ("Conn_Coax",)
        x1, y1, x2, y2 = body_box(sym)
        props = []

        def field(name, value, x, y, hide=False, justify=None):
            eff = ["effects", simbolos.FONT]
            if justify:
                eff.append(["justify"] + justify.split())
            if hide:
                eff.append("hide")
            props.append(["property", Str(name), Str(value), ["at", n(x), n(y), "0"], eff])

        if two_pin or not pins:
            field("Reference", p.ref, ox, oy + y1 - 1.27)
            field("Value", p.value, ox, oy + y2 + 2.54)
        else:
            field("Reference", p.ref, ox + x1, oy + y1 - 1.27, justify="left bottom")
            field("Value", p.value, ox + x1, oy + y2 + 1.27, justify="left top")
        field("Footprint", p.footprint, ox, oy, hide=True)
        datasheet = str(lib_prop(sym, "Datasheet")[2]) if lib_prop(sym, "Datasheet") else ""
        field("Datasheet", "" if datasheet == "~" else datasheet, ox, oy, hide=True)
        desc = lib_prop(sym, "Description")
        field("Description", str(desc[2]) if desc else "", ox, oy, hide=True)
        field("MPN", p.mpn, ox, oy, hide=True)
        field("LCSC", p.lcsc, ox, oy, hide=True)
        field("Fabricante", p.manufacturer, ox, oy, hide=True)
        field("Verificado", "no", ox, oy, hide=True)
        if p.note:
            field("Nota", p.note, ox, oy, hide=True)

        node = ["symbol", ["lib_id", Str(f"{LIB}:{p.symbol}")], ["at", n(ox), n(oy), "0"], ["unit", "1"],
                ["exclude_from_sim", "no"], ["in_bom", "no" if p.symbol in ("Fiducial", "MountingHole") else "yes"],
                ["on_board", "yes"], ["dnp", "yes" if p.dnp else "no"], ["uuid", self.key("s", p.ref)]]
        node += props
        for number in sorted(pins, key=natural):
            node.append(["pin", Str(number), ["uuid", self.key("pin", p.ref, number)]])
        node.append(["instances", ["project", Str(PROJECT), ["path", Str(self.path), ["reference", Str(p.ref)], ["unit", "1"]]]])
        self.items.append(node)

        for number, (px, py, angle, kind, _name) in sorted(pins.items(), key=lambda kv: natural(kv[0])):
            net = p.nets.get(number, NC)
            x, y = ox + px, oy - py
            if net == NC:
                self.no_connect(x, y, f"{p.ref}/{number}")
                continue
            if angle not in (0, 180):
                raise SystemExit(f"{p.symbol}: pin {number} no es horizontal")
            right = angle == 180
            ex = x + (STUB if right else -STUB)
            self.wire(x, y, ex, y, f"{p.ref}/{number}")
            self.terminal(net, ex, y, right, f"{p.ref}/{number}", kind)

    # -- layout -------------------------------------------------------------
    def layout(self):
        groups = []
        for gi, group in enumerate(self.sheet.groups):
            blocks = [(p, self.part_extent(p)) for p in group.parts]
            widest = max(b[1][2] - b[1][0] for b in blocks)
            target = max(group.width or 170.0, widest)
            rows, row, row_w = [], [], 0.0
            for b in blocks:
                w = b[1][2] - b[1][0]
                if row and row_w + GAP + w > target:
                    rows.append(row)
                    row, row_w = [], 0.0
                row.append(b)
                row_w += (GAP if len(row) > 1 else 0) + w
            if row:
                rows.append(row)
            header = 5.08 + 3.81 * len(group.notes)
            width = max(sum(b[1][2] - b[1][0] for b in r) + GAP * (len(r) - 1) for r in rows)
            width = max(width, len(group.title) * 2.0 * 0.9, max([len(t) * CHAR_W for t in group.notes] + [0]))
            height = header + sum(max(b[1][3] - b[1][1] for b in r) for r in rows) + GAP * (len(rows) - 1)
            groups.append((gi, group, rows, snap(width + 5.08), snap(height + 5.08), header))

        for paper, pw, ph in PAPERS:
            placed = self.pack(groups, pw, ph)
            if placed is not None:
                self.paper = paper
                break
        else:
            raise SystemExit(f"{self.sheet.name}: no entra ni en A1")

        for (gi, group, rows, gw, gh, header), (gx, gy) in zip(groups, placed):
            self.rectangle(gx, gy, gx + gw, gy + gh, f"g{gi}")
            self.text(group.title, gx + 2.54, gy + 4.445, f"g{gi}/title", size=2.0)
            for ni, note in enumerate(group.notes):
                self.text(note, gx + 2.54, gy + 4.445 + 3.81 * (ni + 1), f"g{gi}/note{ni}")
            y = gy + 2.54 + header
            for row in rows:
                x = gx + 2.54
                row_h = max(b[1][3] - b[1][1] for b in row)
                for p, (ex1, ey1, ex2, ey2) in row:
                    ox = snap(x - ex1)
                    oy = snap(y - ey1)
                    self.place_part(p, ox, oy)
                    x = ox + ex2 + GAP
                y += row_h + GAP

    @staticmethod
    def pack(groups, pw, ph):
        """Shelf packing; returns the top-left corner of each group, or None if it does not fit."""
        usable_w = pw - 2 * MARGIN
        usable_h = ph - MARGIN - TITLE_BLOCK_H
        x, y, shelf_h = MARGIN, MARGIN, 0.0
        out = []
        for _gi, _g, _rows, gw, gh, _h in groups:
            if gw > usable_w:
                return None
            if x + gw > MARGIN + usable_w:
                x, y, shelf_h = MARGIN, y + shelf_h + GAP, 0.0
            if y + gh > MARGIN + usable_h:
                return None
            out.append((snap(x), snap(y)))
            x += gw + GAP
            shelf_h = max(shelf_h, gh)
        return out

    # -- file ---------------------------------------------------------------
    def render(self) -> str:
        self.layout()
        lib_symbols = ["lib_symbols"]
        for name in sorted(self.used):
            sym = [x for x in self.symbols[name]]
            sym[1] = Str(f"{LIB}:{name}")
            lib_symbols.append(sym)
        title = ["title_block", ["title", Str(self.sheet.title)], ["date", Str(DATE)], ["rev", Str("v0")],
                 ["company", Str("Sport Performance")], ["comment", "1", Str(self.sheet.comment)],
                 ["comment", "2", Str("Spec: docs/hardware/pod-v0.md")],
                 ["comment", "3", Str("Generado por hardware/tools/esquematico/generar.py: no editar a mano")]]
        root = ["kicad_sch", ["version", "20231120"], ["generator", Str("eeschema")], ["generator_version", Str("8.0")],
                ["uuid", Str(self.file_uuid)], ["paper", Str(self.paper)], title, lib_symbols] + self.items
        return dump(root) + "\n"


def verify_sheet(text: str, sheet, symbols) -> list:
    """Rebuild the nets of a written sheet from its geometry and compare them with the design.

    Independent of the layout code: reads wires, labels, power symbols, no-connect markers and the
    pins of every placed symbol, joins coincident points, and checks that each pin lands on the net
    ``diseno.py`` gives it, that no net gets two names and that nothing dangles.
    """
    node = parse(text)
    parent = {}

    def key(x, y):
        return (round(float(x), 3), round(float(y), 3))

    def root(k):
        parent.setdefault(k, k)
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def join(a, b):
        parent[root(a)] = root(b)

    names = defaultdict(set)
    pins_at = []  # (point, ref, number)
    labels = []
    ncs = []
    for item in node:
        if not isinstance(item, list):
            continue
        if item[0] == "wire":
            a, b = find_all(find(item, "pts"), "xy")
            join(key(a[1], a[2]), key(b[1], b[2]))
        elif item[0] in ("label", "global_label"):
            at = find(item, "at")
            labels.append((key(at[1], at[2]), str(item[1])))
        elif item[0] == "no_connect":
            at = find(item, "at")
            ncs.append(key(at[1], at[2]))
        elif item[0] == "symbol":
            lib_id = str(find(item, "lib_id")[1]).split(":", 1)[1]
            at = find(item, "at")
            x, y, rot = float(at[1]), float(at[2]), int(at[3])
            ref = next(str(p[2]) for p in find_all(item, "property") if p[1] == "Reference")
            sym = symbols[lib_id]
            if find(sym, "power") is not None:
                value = next(str(p[2]) for p in find_all(item, "property") if p[1] == "Value")
                pk = key(x, y)
                root(pk)
                if lib_id != "PWR_FLAG":
                    labels.append((pk, value))
                else:
                    pins_at.append((pk, "#FLG", "1"))
                continue
            for number, (px, py, _a, _t, _n) in pin_table(sym).items():
                dx, dy = rot_offset(px, py, rot)
                pk = key(x + dx, y + dy)
                root(pk)
                pins_at.append((pk, ref, number))
    for pk, name in labels:
        if pk not in parent:
            return [f"etiqueta {name} suelta en {pk}"]
        names[root(pk)].add(name)
    errors = []
    for cluster, ns in names.items():
        if len(ns) > 1:
            errors.append(f"una red con dos nombres: {sorted(ns)}")
    expected = {}
    for g in sheet.groups:
        for p in g.parts:
            if p.kind == "part":
                for number, net in p.nets.items():
                    expected[(p.ref, number)] = net
    nc_set = set(ncs)
    cluster_pins = defaultdict(list)
    for pk, ref, number in pins_at:
        cluster_pins[root(pk)].append((ref, number))
        if ref == "#FLG":
            continue
        want = expected.get((ref, number))
        if want == NC:
            if pk not in nc_set:
                errors.append(f"{ref}.{number}: falta la marca de sin conectar")
            continue
        got = names.get(root(pk), set())
        if got != {want}:
            errors.append(f"{ref}.{number}: está en {sorted(got) or 'nada'}, se esperaba {want}")
    for cluster in set(root(k) for k in list(parent)):
        if cluster not in names and not cluster_pins.get(cluster) and cluster not in {root(k) for k in nc_set}:
            errors.append(f"cable suelto en {cluster}")
    return errors


def natural(text: str):
    import re
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", text)]


# ---------------------------------------------------------------------------


def root_info():
    root = parse((PROJECT_DIR / f"{PROJECT}.kicad_sch").read_text(encoding="utf-8"))
    root_uuid = str(find(root, "uuid")[1])
    sheets = {}
    for sheet in find_all(root, "sheet"):
        props = {p[1]: p[2] for p in find_all(sheet, "property")}
        sheets[str(props["Sheetfile"])] = str(find(sheet, "uuid")[1])
    return root_uuid, sheets


def file_uuid(path: Path) -> str:
    if path.exists():
        return str(find(parse(path.read_text(encoding="utf-8")), "uuid")[1])
    return str(uuid.uuid5(NAMESPACE, path.name))


def check_own_footprints() -> list:
    """Every part on a footprint of hardware/lib/pod.pretty: the file exists and has a pad for each pin."""
    errors = []
    lib = REPO / "hardware" / "lib" / "pod.pretty"
    for sheet in diseno.SHEETS:
        for p in (p for g in sheet.groups for p in g.parts if p.kind == "part"):
            if not p.footprint.startswith(diseno.POD):
                continue
            path = lib / (p.footprint[len(diseno.POD):] + ".kicad_mod")
            if not path.exists():
                errors.append(f"{sheet.name} {p.value}: falta {path.relative_to(REPO)}")
                continue
            pads = {str(pad[1]) for pad in find_all(parse(path.read_text(encoding="utf-8")), "pad")}
            missing = sorted((pin for pin in p.nets if pin not in pads), key=natural)
            if missing:
                errors.append(f"{sheet.name} {p.value}: pines sin pad en {path.name}: {', '.join(missing)}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="no escribe: falla si algún archivo cambiaría")
    args = parser.parse_args()

    lib_node, symbols = build_library()
    design = Design(diseno.SHEETS, symbols)
    design.check()
    fp_errors = check_own_footprints()
    if fp_errors:
        raise SystemExit("Footprints propios:\n  " + "\n  ".join(fp_errors))
    root_uuid, sheet_uuids = root_info()

    outputs = {LIB_PATH: dump(lib_node) + "\n"}
    summary = []
    for sheet in diseno.SHEETS:
        path = PROJECT_DIR / f"{sheet.name}.kicad_sch"
        writer = SheetWriter(sheet, design, symbols, root_uuid, sheet_uuids[path.name], file_uuid(path))
        outputs[path] = writer.render()
        problems = verify_sheet(outputs[path], sheet, symbols)
        if problems:
            raise SystemExit(f"{sheet.name}: la verificación de conectividad falló:\n  " + "\n  ".join(problems[:40]))
        parts =[p for g in sheet.groups for p in g.parts if p.kind == "part"]
        summary.append((sheet.name, writer.paper, len(parts), sum(p.dnp for p in parts),
                        [f"{p.ref} {p.value}" for p in parts if not p.footprint and p.symbol not in ("PWR_FLAG",)]))

    stale = []
    for path, text in outputs.items():
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != text:
            stale.append(path)
            if not args.check:
                path.write_text(text, encoding="utf-8")
    if args.check:
        if stale:
            print("Desactualizados (correr generar.py):", ", ".join(str(p.relative_to(REPO)) for p in stale))
            return 1
        print("Esquemático y librería al día.")
        return 0
    for name, paper, count, dnp, no_fp in summary:
        print(f"{name:10s} {paper}  {count:3d} componentes ({dnp} sin montar)")
        if no_fp:
            print("           sin footprint: " + ", ".join(no_fp))
    print(f"Escritos: {len(stale)} archivos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
