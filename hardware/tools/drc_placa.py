"""Verdict of the DRC of the pod v0 board for the CI (B-909). Standard library only.

The CI runs the DRC with ``--format json --schematic-parity --severity-error --severity-warning``, keeps what
kicad-cli prints, and this script reads both:

- fails on any violation (errors and warnings: clearances, courtyards, zones, custom rules, silkscreen…)
  and on any difference with the schematic (``--schematic-parity``);
- fails if the parity check did not run: kicad-cli exits 0 and writes an empty ``schematic_parity`` list when
  it cannot build the schematic netlist ("Failed to fetch schematic netlist for parity tests"), so the log
  has to say "Found N schematic parity issues" and the report has to have its three lists;
- does **not** fail on ``unconnected_items`` (the ratsnest: what is left to route, by hand since 16/11/2026);
  it prints how many. With ``--fallar-sin-rutear`` (for the CI once the board is fully routed) it fails on them
  too and prints the first 20.

    python3 hardware/tools/drc_placa.py drc.json --log drc.log [--fallar-sin-rutear]
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter

KEYS = ("violations", "unconnected_items", "schematic_parity")
PARITY_FAILED = "Failed to fetch schematic netlist for parity tests"
PARITY_RAN = re.compile(r"Found \d+ schematic parity issues")


def describe(v: dict) -> str:
    items = "; ".join(f"{i.get('description', '')} @({i['pos']['x']:.3f}, {i['pos']['y']:.3f})" for i in v.get("items", []))
    return f"[{v['type']}] {v['description']}: {items}"


def main(argv: list[str]) -> int:
    if len(argv) < 2 or "--log" not in argv:
        print(__doc__)
        return 2
    report = json.loads(open(argv[1], encoding="utf-8").read())
    log = open(argv[argv.index("--log") + 1], encoding="utf-8").read()
    missing = [k for k in KEYS if k not in report]
    if missing:
        print(f"FALLA el reporte no tiene {', '.join(missing)}: el DRC no corrió completo")
        return 1
    if PARITY_FAILED in log or not PARITY_RAN.search(log):
        print("FALLA la comparación con el esquemático no corrió (kicad-cli no pudo armar la netlist):")
        print(log)
        return 1
    violations, parity, unconnected = (report[k] for k in ("violations", "schematic_parity", "unconnected_items"))
    for v in violations + parity:
        print("FALLA " + describe(v))
    counts = Counter(v["type"] for v in violations + parity)
    print(f"Violaciones: {len(violations)}, diferencias con el esquemático: {len(parity)}"
          + (f" ({dict(counts)})" if counts else ""))
    print(f"Conexiones sin rutear: {len(unconnected)}")
    if "--fallar-sin-rutear" in argv:
        for v in unconnected[:20]:
            print("FALLA " + describe(v))
    if "--fallar-sin-rutear" in argv and unconnected:
        return 1
    return 1 if violations or parity else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
