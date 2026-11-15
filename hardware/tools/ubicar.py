"""Initial placement of the pod v0 board from the generated schematic (B-909). One-shot bootstrap tool.

What it does, inside the official KiCad image (it needs KiCad's ``pcbnew`` Python module and ``kicad-cli``):

1. Exports the netlist of ``pod-v0.kicad_sch`` with ``kicad-cli sch export netlist`` (the same data that
   "Tools → Update PCB from Schematic" reads).
2. Adds to ``pod-v0.kicad_pcb`` every footprint of the schematic that is not on the board yet, with the same
   things the update from the schematic writes: reference, value, the symbol fields (MPN, LCSC, Fabricante,
   Verificado…), the sheet path (so later updates from the schematic and ``--schematic-parity`` match them),
   DNP, and the net of every pad. Pins the netlist leaves unconnected get KiCad's own ``unconnected-(…)`` nets.
3. Puts every footprint where ``datos/ubicacion_pod_v0.csv`` says (doc coordinates: origin (0; 0) = (100; 100)
   in KiCad, x to the right, y down, seen from the patch side; ``cara`` F or B; ``rot`` in degrees as KiCad
   shows it in the footprint properties; ``fijo`` = locked), sets the reference text to 0.8 mm and moves it
   to a free spot around the part (or hides it on the silkscreen when there is none: it stays on F.Fab/B.Fab).
4. Refills the zones and saves the board. It does not route anything.

It is a bootstrap: the layout continues by hand in KiCad, and from then on the board, not the CSV, is the
source of the placement. By default it only adds and places the parts that are not on the board yet (for
example after adding one in ``diseno.py``); the parts already on the board are not moved, and their fields
keep their layer and visibility (on the committed board a run changes nothing). ``--reubicar-todo`` puts every
part back at its CSV position, locked ones included, and refuses to run once the board has tracks or vias.

    docker run --rm -e HOME=/tmp -v "$PWD:/work" -w /work kicad/kicad:10.0.8@sha256:… \\
        python3 hardware/tools/ubicar.py [--reubicar-todo] [--placa otra.kicad_pcb]
"""

from __future__ import annotations

import csv
import subprocess
import sys
import tempfile
from pathlib import Path

import pcbnew

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS / "esquematico"))
import sexpr  # noqa: E402

HW = TOOLS.parent
POD = HW / "pod-v0"
CSV = TOOLS / "datos" / "ubicacion_pod_v0.csv"
ORIGIN = (100.0, 100.0)
REF_SIZE = 0.8  # mm, silkscreen reference
REF_THICKNESS = 0.12
# Symbol fields that are not copied as footprint fields (they are the footprint's own reference, value and id).
SKIP_FIELDS = {"Reference", "Value", "Footprint"}
BUILTIN_FIELDS = {"Datasheet", "Description"}


def kids(node: list, key: str) -> list:
    return [c for c in node if isinstance(c, list) and c and c[0] == key]


def value(node: list, key: str):
    found = kids(node, key)
    return found[0][1] if found and len(found[0]) > 1 else None


def netlist() -> tuple[list[dict], dict]:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pod-v0.net"
        subprocess.run(["kicad-cli", "sch", "export", "netlist", "--format", "kicadsexpr", "--output", str(out),
                        str(POD / "pod-v0.kicad_sch")], check=True, capture_output=True)
        tree = sexpr.parse(out.read_text(encoding="utf-8"))
    comps = []
    for c in kids(kids(tree, "components")[0], "comp"):
        props = {value(p, "name"): value(p, "value") for p in kids(c, "property")}
        fields = {value(f, "name"): (f[2] if len(f) > 2 else "") for f in kids(kids(c, "fields")[0], "field")}
        sheet = kids(c, "sheetpath")[0]
        comps.append({"ref": value(c, "ref"), "value": value(c, "value"), "footprint": value(c, "footprint"),
                      "fields": {k: v for k, v in fields.items() if k not in SKIP_FIELDS},
                      "path": value(sheet, "tstamps") + value(c, "tstamps"), "sheetname": value(sheet, "names"),
                      "sheetfile": props.get("Sheetfile", ""), "dnp": "dnp" in props,
                      "no_bom": "exclude_from_bom" in props, "no_board": "exclude_from_board" in props})
    pins: dict[str, dict[str, str]] = {}
    for n in kids(kids(tree, "nets")[0], "net"):
        for node in kids(n, "node"):
            pins.setdefault(value(node, "ref"), {})[value(node, "pin")] = value(n, "name")
    return comps, pins


def library(lib: str) -> str:
    if lib == "pod":
        return str(HW / "lib" / "pod.pretty")
    return f"/usr/share/kicad/footprints/{lib}.pretty"


def mm(v: float) -> int:
    return pcbnew.FromMM(v)


def board_net(board, name: str):
    net = board.FindNet(name)
    if net is None:
        net = pcbnew.NETINFO_ITEM(board, name)
        board.Add(net)
    return net


def add_footprint(board, comp: dict):
    lib, name = comp["footprint"].split(":")
    fp = pcbnew.FootprintLoad(library(lib), name)
    if fp is None:
        raise SystemExit(f"{comp['ref']}: no encuentro el footprint {comp['footprint']}")
    fp.SetFPID(pcbnew.LIB_ID(lib, name))
    fp.SetReference(comp["ref"])
    for field in fp.GetFields():  # library fields without a pen width get 0.15 mm on the next load: set it now
        if field.GetTextThickness() == 0:
            field.SetTextThickness(mm(0.15))
    board.Add(fp)
    return fp


def sync(board, fp, comp: dict, pins: dict) -> None:
    """What "Update PCB from Schematic" writes into a footprint: value, fields, sheet path, DNP, BOM, nets."""
    if fp.GetValue() != comp["value"]:
        fp.SetValue(comp["value"])
    for key, text in comp["fields"].items():
        created = not fp.HasField(key)
        if not created and fp.GetFieldText(key) == text:
            continue  # SetField rewrites the text style even with the same text: leave it alone
        fp.SetField(key, text)
        if created and key not in BUILTIN_FIELDS:  # a field that already exists keeps its layer and visibility
            field = fp.GetField(key)
            field.SetVisible(False)
            field.SetLayer(pcbnew.B_Fab if fp.IsFlipped() else pcbnew.F_Fab)
            field.SetTextThickness(mm(0.15))  # what KiCad gives it on the next load: a re-run changes nothing
    fp.SetPath(pcbnew.KIID_PATH(comp["path"]))
    fp.SetSheetname(comp["sheetname"])
    fp.SetSheetfile(comp["sheetfile"])
    fp.SetDNP(comp["dnp"])
    fp.SetExcludedFromBOM(comp["no_bom"])  # library test points come excluded; the symbol decides
    nets = pins.get(comp["ref"], {})
    for pad in fp.Pads():
        net = nets.get(pad.GetNumber())
        if net:
            pad.SetNet(board_net(board, net))


def place(fp, row: dict) -> None:
    x, y = float(row["x"]) + ORIGIN[0], float(row["y"]) + ORIGIN[1]
    if fp.IsFlipped() != (row["cara"] == "B"):
        fp.Flip(fp.GetPosition(), pcbnew.FLIP_DIRECTION_LEFT_RIGHT)
    fp.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
    fp.SetOrientationDegrees(float(row["rot"]))
    fp.SetLocked(row["fijo"] == "sí")


def rect_of(item, grow: float = 0.0):
    box = item.GetBoundingBox()
    g = mm(grow)
    return (box.GetLeft() - g, box.GetTop() - g, box.GetRight() + g, box.GetBottom() + g)


def overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def place_references(board, placed: set) -> int:
    """Reference text at 0.8 mm on a free spot next to its part (only the parts placed now); hidden when
    no spot is free."""
    edge = board.GetBoardEdgesBoundingBox()
    inside = (edge.GetLeft() + mm(0.3), edge.GetTop() + mm(0.3), edge.GetRight() - mm(0.3), edge.GetBottom() - mm(0.3))
    edges = [d.GetEffectiveShape() for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
    taken = {pcbnew.F_SilkS: [], pcbnew.B_SilkS: []}
    pads = {pcbnew.F_SilkS: [], pcbnew.B_SilkS: []}
    fps = sorted(board.GetFootprints(), key=lambda f: f.GetReference())
    for fp in fps:
        for pad in fp.Pads():
            for silk, cu in ((pcbnew.F_SilkS, pcbnew.F_Cu), (pcbnew.B_SilkS, pcbnew.B_Cu)):
                if pad.IsOnLayer(cu):
                    pads[silk].append(rect_of(pad, 0.2))
        for item in fp.GraphicalItems():
            if item.GetLayer() in taken:
                taken[item.GetLayer()].append(rect_of(item, 0.1))
        if fp.GetReference() not in placed and fp.Reference().IsVisible():
            taken.setdefault(fp.Reference().GetLayer(), []).append(rect_of(fp.Reference(), 0.1))
    hidden = 0
    # Big parts first: they have the most room around them.
    for fp in sorted(fps, key=lambda f: -f.GetBoundingBox(False).GetArea()):
        if fp.GetReference() not in placed:
            continue
        ref = fp.Reference()
        silk = pcbnew.B_SilkS if fp.IsFlipped() else pcbnew.F_SilkS
        ref.SetVisible(True)
        ref.SetTextSize(pcbnew.VECTOR2I(mm(REF_SIZE), mm(REF_SIZE)))
        ref.SetTextThickness(mm(REF_THICKNESS))
        ref.SetTextAngleDegrees(0)
        ref.SetKeepUpright(True)
        if fp.GetReference().startswith(("H", "FID")):
            ref.SetVisible(False)
            continue
        box = fp.GetBoundingBox(False)
        cx, cy = box.GetCenter().x, box.GetCenter().y
        half_w, half_h = box.GetWidth() // 2, box.GetHeight() // 2
        half_t = mm(len(fp.GetReference()) * REF_SIZE * 0.45)
        candidates = []
        for gap in (0.2, 0.6, 1.0):
            g = mm(gap + REF_SIZE / 2)
            candidates += [(cx, cy - half_h - g), (cx, cy + half_h + g), (cx - half_w - g - half_t, cy),
                           (cx + half_w + g + half_t, cy), (cx - half_w - half_t, cy - half_h - g),
                           (cx + half_w + half_t, cy - half_h - g), (cx - half_w - half_t, cy + half_h + g),
                           (cx + half_w + half_t, cy + half_h + g)]
        for px, py in candidates:
            ref.SetPosition(pcbnew.VECTOR2I(int(px), int(py)))
            r = rect_of(ref, 0.0)
            ok = (r[0] >= inside[0] and r[1] >= inside[1] and r[2] <= inside[2] and r[3] <= inside[3]
                  and not any(e.Collide(ref.GetEffectiveShape(), mm(0.3)) for e in edges)
                  and not any(overlaps(r, o) for o in taken[silk]) and not any(overlaps(r, o) for o in pads[silk]))
            if ok:
                taken[silk].append(rect_of(ref, 0.1))
                break
        else:
            ref.SetVisible(False)
            hidden += 1
    return hidden


def main(argv: list[str]) -> int:
    everything = "--reubicar-todo" in argv
    path = Path(argv[argv.index("--placa") + 1]) if "--placa" in argv else POD / "pod-v0.kicad_pcb"
    comps, pins = netlist()
    with CSV.open(encoding="utf-8") as fh:
        rows = {r["ref"]: r for r in csv.DictReader(fh)}
    wanted = {c["ref"] for c in comps if not c["no_board"]}
    missing = sorted(wanted - rows.keys())
    extra = sorted(rows.keys() - wanted)
    if missing or extra:
        raise SystemExit(f"La tabla no coincide con el esquemático. Faltan: {missing}. Sobran: {extra}")
    board = pcbnew.LoadBoard(str(path))
    if everything and len(board.GetTracks()):
        raise SystemExit("--reubicar-todo pisa la ubicación hecha a mano y la placa ya tiene pistas o vías: no se corre")
    on_board = {fp.GetReference(): fp for fp in board.GetFootprints()}
    added, placed = 0, set()
    for comp in comps:
        if comp["no_board"]:
            continue
        fp = on_board.get(comp["ref"])
        new = fp is None
        if new:
            fp = add_footprint(board, comp)
            added += 1
        sync(board, fp, comp, pins)
        if new or everything:
            place(fp, rows[comp["ref"]])
            placed.add(comp["ref"])
    hidden = place_references(board, placed)
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())
    # Saving from Python rewrites the .kicad_pro with every default setting: keep the hand-kept project file.
    project = path.with_suffix(".kicad_pro")
    kept = project.read_bytes() if project.exists() else None
    board.Save(str(path))
    if kept is not None:
        project.write_bytes(kept)
    print(f"{added} footprints agregados, {len(placed)} ubicados, {hidden} referencias ocultas en la serigrafía: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
