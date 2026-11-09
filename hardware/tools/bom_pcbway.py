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
]

# Columns of PCBWay's turnkey BOM (assembly-file-requirements: line, quantity, designators, manufacturer,
# manufacturer part number, distributor part number, description, package, type SMT/Thru-hole), plus
# the notes for the assembler, the DNP flag, the supplier numbers and the customer-supplied flag.
PCBWAY_COLS = ["Line #", "Reference Designator", "Quantity", "Manufacturer", "Manufacturer Part Number",
               "Distributor Part Number", "Description", "Package", "Type", "Instructions", "DNP", "LCSC", "DigiKey", "Mouser",
               "Customer Supplied"]


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
    bom, dnp, jlc, cost = [], [], [], []
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
            "Customer Supplied": "yes" if info.get("consignado") == "sí" else "",
        }
        if g["dnp"]:
            dnp.append(row)
            continue
        bom.append(row)
        jlc.append({"Comment": f"{mpn} {first.value}".strip() if first.value not in mpn else mpn, "Designator": refs,
                    "Footprint": footprint, "LCSC Part #": info.get("lcsc", "")})
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
        extras.append({"MPN": mpn, "Fabricante": info["fabricante"], "Descripción": info["descripcion"],
                       "Cant. por placa": per_board, "Para qué": purpose, "LCSC": info["lcsc"], "DigiKey": info["digikey"],
                       "Lo mandamos nosotros": "sí" if info.get("consignado") == "sí" else "",
                       "Escalones US$": info["escalones_usd"], "Fuente": info["fuente_precio"]})

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
    summary = {
        "filas montadas": len(bom), "componentes montados": sum(r["Quantity"] for r in bom),
        "filas sin montar": len(dnp), "componentes sin montar": sum(r["Quantity"] for r in dnp),
        "pads de componentes montados (estimación de juntas)": pads, "elementos de placa sin parte": features,
        "sin precio": ", ".join(unpriced) or "ninguno",
    }
    summary.update({f"partes por placa con {n} placas (US$)": f"{totals[n] / n:.2f}" for n in BOARDS})
    return files, summary, errors


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
