"""Verdict of the DRC of the pod v0 board for the CI (B-909). Standard library only.

Since 15/11/2026 the board has every footprint of the schematic but no tracks yet, so the DRC reports every
net as unconnected. kicad-cli has no switch to leave that one check out, so the CI runs it with
``--format json --schematic-parity --severity-error --severity-warning`` and this script reads the report:

- fails on any violation (errors and warnings: clearances, courtyards, zones, custom rules, silkscreen…)
  and on any difference with the schematic (``--schematic-parity``);
- does **not** fail on ``unconnected_items`` (the ratsnest: what is left to route); it prints how many.

When the board is routed, the CI goes back to failing on unconnected items too (``--fallar-sin-rutear``).

    python3 hardware/tools/drc_placa.py drc.json [--fallar-sin-rutear]
"""

from __future__ import annotations

import json
import sys
from collections import Counter


def describe(v: dict) -> str:
    items = "; ".join(f"{i.get('description', '')} @({i['pos']['x']:.3f}, {i['pos']['y']:.3f})" for i in v.get("items", []))
    return f"[{v['type']}] {v['description']}: {items}"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    report = json.loads(open(argv[1], encoding="utf-8").read())
    violations = report.get("violations", [])
    parity = report.get("schematic_parity", [])
    unconnected = report.get("unconnected_items", [])
    for v in violations + parity:
        print("FALLA " + describe(v))
    counts = Counter(v["type"] for v in violations + parity)
    print(f"Violaciones: {len(violations)}, diferencias con el esquemático: {len(parity)}"
          + (f" ({dict(counts)})" if counts else ""))
    print(f"Conexiones sin rutear (no falla mientras la placa no esté ruteada): {len(unconnected)}")
    if "--fallar-sin-rutear" in argv and unconnected:
        return 1
    return 1 if violations or parity else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
