#!/usr/bin/env python3
"""BOMs and part cost of the pod v0 for the quote (issue 278), from the netlist (standard library only).

Usage (from any folder):

    python3 hardware/tools/bom_pcbway.py           # write the files of docs/hardware/cotizacion/
    python3 hardware/tools/bom_pcbway.py --check   # fail if a file is out of date or a part has no data

Inputs:

* ``tools/esquematico/diseno.py`` (with ``catalogo.py``): every part, value, footprint, MPN, LCSC
  and DNP. References are assigned by the generator's own code, so they match the schematic.
* ``tools/datos/partes_pod_v0.csv``: per MPN, the supplier numbers (LCSC, DigiKey), stock, price
  ladder with its source and date, whether we supply it (consigned) and the notes for the assembler.

Outputs (``docs/hardware/cotizacion/``):

* ``bom-pod-v0.csv``: assembly BOM in PCBWay's template columns plus DNP, supplier numbers and
  customer-supplied flag, one row per MPN, mounted parts only.
* ``bom-pod-v0-sin-montar.csv``: same columns for the DNP places (rescue and options).
* ``bom-pod-v0-jlcpcb.csv``: JLCPCB's BOM format (Comment, Designator, Footprint, LCSC Part #).
* ``bom-pod-v0-extras.csv``: what is bought but not soldered by the assembler (antennas off the
  board, bench kit for the RF tuning).
* ``costo-partes-pod-v0.csv``: per row, the buy quantity, unit price and extended cost for 5, 10
  and 100 boards, using the ladder of the CSV (a buy quantity below the first step pays the first
  step, the minimum order).
* ``costos.md``: the block between its markers (part totals per board, cost drivers, extras with
  their cost), so the document says the same numbers as the CSV.
* ``stock.md``: the block between its markers (stock status of every mounted part and extra for the
  run of 100 pods plus the 5 v0 boards, with sources, lead time and alternatives), from the stock
  columns of the CSV.

Board features with no part (test points, fiducials, tooling holes, solder jumpers, the Tag-Connect
footprint and the dock pads) are not in the BOMs.
"""

from __future__ import annotations

import argparse
import csv
import io
import math
import re
import sys
from collections import OrderedDict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "esquematico"))

import diseno  # noqa: E402
import generar  # noqa: E402

REPO = HERE.parents[1]
PARTS_CSV = HERE / "datos" / "partes_pod_v0.csv"
OUT = REPO / "docs" / "hardware" / "cotizacion"

NO_PART = {"TestPoint", "Fiducial", "MountingHole", "SolderJumper_Bridged", "TC2030-NL", "Pads_Base"}
THT = {"Antenna"}
SMALL = {"R", "C", "L", "D_ESD"}  # small passives: the assembler adds attrition
ATTRITION = 10  # extra pieces per small-passive row and order (assembler losses)
BOARDS = (5, 10, 100)

# Bought for the build but not soldered by the assembler: (mpn, quantity per board, purpose)
EXTRAS = [
    ("AGVLB.25B.07.0060A", 0.4, "Rescate y referencia de banco por el U.FL (2 por cada 5 placas); no se suelda"),
    ("TX915-FPC-4510", 1, "Antena LoRa FPC pegada en la carcasa, al U.FL del E22; no se suelda"),
    ("LQW15AN10NG00D", 2, "Kit de banco: L de entrada del LNA en alta ganancia"),
    ("LQW15AN12NG00D", 2, "Kit de banco: L de entrada del LNA en bajo consumo"),
    ("0402WGF374JTCE", 2, "Kit de banco: serie del atenuador de 6 dB con la Taoglas"),
    ("NCP15XH103F03RC", 2, "Kit de banco: NTC de 10 kΩ para el TS sin la celda"),
    ("PESD5V0F1BL,315", 2, "Kit de banco: ESD de silicio de 0,4 pF para el nodo del U.FL"),
]

COSTOS_MD = OUT / "costos.md"
STOCK_MD = OUT / "stock.md"
RUN = 105  # boards the stock audit covers: the run of 100 pods plus the 5 v0 boards
STATES = ("OK", "LIMITADO", "SIN STOCK")
BEGIN = "<!-- generado por hardware/tools/bom_pcbway.py: no editar a mano -->"
END = "<!-- fin de lo generado -->"
TOP = 6  # rows of the cost drivers table

# Columns of PCBWay's turnkey BOM (assembly-file-requirements: line, quantity, designators, manufacturer,
# manufacturer part number, distributor part number, description, package, type SMT/Thru-hole), plus
# the notes for the assembler, the DNP flag, the supplier numbers and the customer-supplied flag.
PCBWAY_COLS = ["Line #", "Reference Designator", "Quantity", "Manufacturer", "Manufacturer Part Number",
               "Distributor Part Number", "Description", "Package", "Type", "Instructions", "DNP", "LCSC", "DigiKey", "Mouser",
               "Customer Supplied", "Approved Alternate"]


def natural(ref: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", ref)]


def load_parts() -> dict:
    with PARTS_CSV.open(encoding="utf-8", newline="") as f:
        return {r["mpn"]: r for r in csv.DictReader(f)}


def ladder(row: dict) -> list:
    text = row.get("escalones_usd", "")
    return [(int(q), float(p)) for q, p in (s.split(":") for s in text.split(";") if s)]


def unit_price(steps: list, qty: int) -> tuple:
    """(buy quantity, unit price) for ``qty`` pieces with a price ladder."""
    if not steps:
        return qty, None
    buy = max(qty, steps[0][0])
    price = steps[0][1]
    for q, p in steps:
        if buy >= q:
            price = p
    return buy, price


def collect():
    _, symbols = generar.build_library()
    design = generar.Design(diseno.SHEETS, symbols)
    if design.errors:
        raise SystemExit("La netlist tiene errores: correr generar.py")
    groups = OrderedDict()  # (dnp, mpn or value) -> dict
    features = 0
    pads = 0
    for sheet in diseno.SHEETS:
        for group in sheet.groups:
            for p in group.parts:
                if p.kind != "part":
                    continue
                if p.symbol in NO_PART:
                    features += 1
                    continue
                key = (p.dnp, p.mpn or f"{p.symbol} {p.value}")
                g = groups.setdefault(key, {"parts": [], "dnp": p.dnp, "mpn": p.mpn})
                g["parts"].append(p)
                if not p.dnp:
                    pads += len(p.nets)
    return groups, features, pads


def alternate(parts: dict, info: dict, errors: list) -> str:
    """Approved drop-in alternate for the assembler ("MPN (LCSC Cxxx)"), checked against the CSV."""
    alt = info.get("alternativa_directa", "")
    if not alt:
        return ""
    other = parts.get(alt)
    if not other:
        errors.append(f"{info['mpn']}: la alternativa {alt} no está en {PARTS_CSV.name}")
        return alt
    return f"{alt} (LCSC {other['lcsc']})" if other.get("lcsc") else alt


def write_csv(rows: list, cols: list) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def build():
    parts = load_parts()
    groups, features, pads = collect()
    errors = []
    bom, dnp, jlc, cost, stock = [], [], [], [], []
    totals = {n: 0.0 for n in BOARDS}
    unpriced = []
    mounted_sorted = sorted(groups.values(), key=lambda g: natural(sorted((p.ref for p in g["parts"]), key=natural)[0]))
    for g in mounted_sorted:
        ps = sorted(g["parts"], key=lambda p: natural(p.ref))
        first = ps[0]
        refs = ",".join(p.ref for p in ps)
        footprint = first.footprint.split(":")[-1]
        mpn = g["mpn"]
        info = parts.get(mpn, {}) if mpn else {}
        if mpn and not info:
            errors.append(f"{refs}: {mpn} no está en {PARTS_CSV.name}")
        if not mpn and not (g["dnp"] and first.value == "DNP"):
            errors.append(f"{refs}: {first.symbol} {first.value} sin MPN")
        distributor = info.get("digikey") if info.get("fuente_precio") == "digikey" else info.get("lcsc", first.lcsc)
        row = {
            "Reference Designator": refs, "Quantity": len(ps), "Manufacturer": info.get("fabricante", first.manufacturer),
            "Manufacturer Part Number": mpn or "(sin valor: lugar de ajuste)", "Distributor Part Number": distributor or "",
            "Description": info.get("descripcion") or f"{first.symbol} {first.value}",
            "Package": footprint, "Type": "Thru-hole" if first.symbol in THT else "SMT",
            "Instructions": "Do not populate" if g["dnp"] else info.get("instrucciones", ""),
            "DNP": "yes" if g["dnp"] else "no", "LCSC": info.get("lcsc", first.lcsc),
            "DigiKey": info.get("digikey", ""), "Mouser": info.get("mouser", ""),
            "Customer Supplied": {"sí": "yes", "posible": "maybe"}.get(info.get("consignado", ""), ""),
            "Approved Alternate": alternate(parts, info, errors),
        }
        if g["dnp"]:
            dnp.append(row)
            continue
        bom.append(row)
        jlc.append({"Comment": f"{mpn} {first.value}".strip() if first.value not in mpn else mpn, "Designator": refs,
                    "Footprint": footprint, "LCSC Part #": info.get("lcsc", "")})
        stock.append((refs, len(ps), first.symbol in SMALL, info))
        steps = ladder(info)
        line = {"MPN": mpn, "Designadores": refs, "Cant. por placa": len(ps), "Fuente": info.get("fuente_precio", ""),
                "Fecha": info.get("fecha", "")}
        for n in BOARDS:
            need = len(ps) * n + (ATTRITION if first.symbol in SMALL else 0)
            buy, price = unit_price(steps, need)
            line[f"Compra {n}"] = buy
            line[f"US$ unit. {n}"] = "" if price is None else f"{price:.4f}"
            ext = 0.0 if price is None else buy * price
            line[f"US$ total {n}"] = "" if price is None else f"{ext:.2f}"
            totals[n] += ext
        if not steps:
            unpriced.append(mpn)
        cost.append(line)
    for i, r in enumerate(bom, 1):
        r["Line #"] = i
    for i, r in enumerate(dnp, 1):
        r["Line #"] = i
    total = {"MPN": "TOTAL", "Designadores": "", "Cant. por placa": sum(r["Quantity"] for r in bom), "Fuente": "", "Fecha": ""}
    per_pod = {"MPN": "POR PLACA", "Designadores": "", "Cant. por placa": "", "Fuente": "", "Fecha": ""}
    for n in BOARDS:
        total.update({f"Compra {n}": "", f"US$ unit. {n}": "", f"US$ total {n}": f"{totals[n]:.2f}"})
        per_pod.update({f"Compra {n}": "", f"US$ unit. {n}": "", f"US$ total {n}": f"{totals[n] / n:.2f}"})
    cost += [total, per_pod]

    extras = []
    for mpn, per_board, purpose in EXTRAS:
        info = parts.get(mpn)
        if not info:
            errors.append(f"extra {mpn} no está en {PARTS_CSV.name}")
            continue
        row = {"MPN": mpn, "Fabricante": info["fabricante"], "Descripción": info["descripcion"],
               "Cant. por placa": per_board, "Para qué": purpose, "LCSC": info["lcsc"], "DigiKey": info["digikey"],
               "Lo mandamos nosotros": "sí" if info.get("consignado") == "sí" else "",
               "Escalones US$": info["escalones_usd"], "Fuente": info["fuente_precio"]}
        for n in BOARDS:
            buy, price = unit_price(ladder(info), math.ceil(per_board * n))
            row[f"US$ total {n}"] = "" if price is None else f"{buy * price:.2f}"
        extras.append(row)

    cost_cols = ["MPN", "Designadores", "Cant. por placa", "Fuente", "Fecha"]
    for n in BOARDS:
        cost_cols += [f"Compra {n}", f"US$ unit. {n}", f"US$ total {n}"]
    files = {
        OUT / "bom-pod-v0.csv": write_csv(bom, PCBWAY_COLS),
        OUT / "bom-pod-v0-sin-montar.csv": write_csv(dnp, PCBWAY_COLS),
        OUT / "bom-pod-v0-jlcpcb.csv": write_csv(jlc, ["Comment", "Designator", "Footprint", "LCSC Part #"]),
        OUT / "bom-pod-v0-extras.csv": write_csv(extras, list(extras[0]) if extras else ["MPN"]),
        OUT / "costo-partes-pod-v0.csv": write_csv(cost, cost_cols),
    }
    files[COSTOS_MD] = costos_md(cost[:-2], totals, extras)
    files[STOCK_MD] = stock_md(stock, parts, errors)
    summary = {
        "filas montadas": len(bom), "componentes montados": sum(r["Quantity"] for r in bom),
        "filas sin montar": len(dnp), "componentes sin montar": sum(r["Quantity"] for r in dnp),
        "pads de componentes montados (estimación de juntas)": pads, "elementos de placa sin parte": features,
        "sin precio": ", ".join(unpriced) or "ninguno",
    }
    summary.update({f"partes por placa con {n} placas (US$)": f"{totals[n] / n:.2f}" for n in BOARDS})
    return files, summary, errors


def money(x: float) -> str:
    """US$ amount in es-AR format (1.234,56)."""
    return f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def costos_md(lines: list, totals: dict, extras: list) -> str:
    """costos.md with the generated block (part totals, cost drivers, extras) replaced."""
    out = ["| Placas | Partes por placa | Total de partes |", "|---|---|---|"]
    out += [f"| {n} | **{money(totals[n] / n)}** | {money(totals[n])} |" for n in BOARDS]
    n = BOARDS[-1]
    top = sorted(lines, key=lambda r: -float(r[f"US$ total {n}"] or 0))
    out += ["", f"**Lo que más pesa** (a {n} placas, por placa):", "", "| Parte | Cant. | US$ por placa | Fuente |", "|---|---|---|---|"]
    out += [f"| {r['MPN']} | {r['Cant. por placa']} | {money(float(r[f'US$ total {n}']) / n)} | {r['Fuente']} |" for r in top[:TOP]]
    rest = sum(float(r[f"US$ total {n}"] or 0) for r in top[TOP:]) / n
    out += [f"| Las otras {len(top) - TOP} filas | — | {money(rest)} | — |"]
    out += ["", "**Lo que no se suelda** ([`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv)), total del pedido:", "",
            "| Parte | Para qué | " + " | ".join(f"{b} placas" for b in BOARDS) + " |", "|---|---|" + "---|" * len(BOARDS)]
    for e in extras:
        cells = [money(float(e[f"US$ total {b}"])) if e[f"US$ total {b}"] else "sin precio" for b in BOARDS]
        out.append(f"| {e['MPN']} | {e['Para qué']} | " + " | ".join(cells) + " |")
    sums = [sum(float(e[f"US$ total {b}"] or 0) for e in extras) for b in BOARDS]
    out.append("| **Total** | | " + " | ".join(f"**{money(x)}**" for x in sums) + " |")
    return replace_block(COSTOS_MD, out)


def replace_block(path: Path, lines: list) -> str:
    """``path`` with the text between its generated-block markers replaced by ``lines``."""
    text = path.read_text(encoding="utf-8")
    if text.count(BEGIN) != 1 or text.count(END) != 1:
        raise SystemExit(f"{path.name}: faltan los marcadores del bloque generado")
    head, rest_text = text.split(BEGIN)
    _, tail = rest_text.split(END)
    return head + BEGIN + "\n\n" + "\n".join(lines) + "\n\n" + END + tail


def stock_md(stock: list, parts: dict, errors: list) -> str:
    """stock.md with the generated table (stock status per mounted part and extra) replaced."""
    def num(x: str) -> str:
        return f"{int(x):,}".replace(",", ".") if x.isdigit() else (x or "—")

    rows = [(refs, qty, small, info) for refs, qty, small, info in stock]
    rows += [("(no se suelda)", per_board, False, parts[mpn]) for mpn, per_board, _ in EXTRAS if mpn in parts]
    order = {s: i for i, s in enumerate(STATES[::-1])}
    rows.sort(key=lambda r: (order.get(r[3].get("estado_stock", ""), 9), natural(r[0])))
    out = [f"| Parte | Lugar | Hacen falta ({RUN} placas) | Estado | LCSC | DigiKey | JLCPCB | Otras fuentes | Plazo | "
           "Alternativa directa | Otras alternativas |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for refs, qty, small, info in rows:
        state = info.get("estado_stock", "")
        if state not in STATES:
            errors.append(f"{info['mpn']}: estado_stock '{state}' (tiene que ser {', '.join(STATES)})")
        need = math.ceil(qty * RUN) + (ATTRITION if small else 0)
        mark = {"OK": "✓ OK", "LIMITADO": "⚠ LIMITADO", "SIN STOCK": "✗ SIN STOCK"}.get(state, state)
        cells = [f"`{info['mpn']}`", refs.replace(",", ", ") if len(refs) <= 24 else f"{refs.split(',')[0]} y otros",
                 num(str(need)), mark, num(info.get("stock_lcsc", "")), num(info.get("stock_digikey", "")),
                 num(info.get("stock_jlcpcb", "")), info.get("stock_otras") or "—", info.get("plazo") or "—",
                 f"`{info['alternativa_directa']}`" if info.get("alternativa_directa") else "—",
                 info.get("alternativas_otras") or "—"]
        out.append("| " + " | ".join(c.replace("|", "/") for c in cells) + " |")
    dates = sorted({info.get("fecha_stock", "") for *_, info in rows} - {""})
    out += ["", f"Stock leído el {', '.join('/'.join(d.split('-')[::-1]) for d in dates)} (columnas de stock de "
            "[`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv))."]
    return replace_block(STOCK_MD, out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="no escribe: falla si algún archivo cambiaría")
    args = parser.parse_args()
    files, summary, errors = build()
    if errors:
        print("Errores:\n  " + "\n  ".join(errors))
        return 1
    stale = [p for p, text in files.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
    if args.check:
        if stale:
            print("Desactualizados (correr bom_pcbway.py):", ", ".join(str(p.relative_to(REPO)) for p in stale))
            return 1
        print("BOM y costos al día.")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for p in stale:
        p.write_text(files[p], encoding="utf-8")
    for k, v in summary.items():
        print(f"{k}: {v}")
    print(f"Escritos: {len(stale)} archivos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
