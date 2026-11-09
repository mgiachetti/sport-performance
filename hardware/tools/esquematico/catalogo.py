"""Orderable parts for the generic passives of the netlist (issue 278, quote package).

``diseno.py`` writes R, C and L by value and footprint; this table turns each (symbol, value,
footprint) into a concrete orderable part (MPN, manufacturer, LCSC). ``completar`` fills the
fields of every passive that does not name its own part, so the schematic (MPN, LCSC and
Fabricante fields) and the BOMs of ``hardware/tools/bom_pcbway.py`` say the same thing.

Choice rules (stock, price and sources in ``hardware/tools/datos/partes_pod_v0.csv``):

* Resistors: UNI-ROYAL thick film, 1 % (the 0402WGF series is 1 % in every value).
* Capacitors: Samsung X5R/X7R for decoupling, C0G for anything below 1 nF. In the GNSS RF chain
  (DC blocks of 100 pF and 1 nF, 68 pF at the LNA) Murata GRM C0G.
* RF inductors: Murata LQW15AN (wire-wound 0402, high Q), the family the BGA525N6 and SAW sheets use.

Value "DNP" (tuning places with no value yet) has no part on purpose.
"""

from __future__ import annotations

from modelo import C0402, C0603, C1206, L0402, R0402, R0805

UR = "UNI-ROYAL"
SAM = "Samsung Electro-Mechanics"
MUR = "Murata"

# (symbol, value, footprint) -> (mpn, manufacturer, lcsc)
PASIVOS = {
    # Resistors
    ("R", "0", R0402): ("0402WGF0000TCE", UR, "C17168"),
    ("R", "22", R0402): ("0402WGF220JTCE", UR, "C25092"),
    ("R", "150", R0402): ("0402WGF1500TCE", UR, "C25082"),
    ("R", "1k", R0402): ("0402WGF1001TCE", UR, "C11702"),
    ("R", "3.32k 1%", R0402): ("0402WGF3321TCE", UR, "C60075"),
    ("R", "4.7k", R0402): ("0402WGF4701TCE", UR, "C25900"),
    ("R", "8.25k 1%", R0402): ("0402WGF8251TCE", UR, "C95598"),
    ("R", "10k", R0402): ("0402WGF1002TCE", UR, "C25744"),
    ("R", "16.2k 1%", R0402): ("0402WGF1622TCE", UR, "C27176"),
    ("R", "47k", R0402): ("0402WGF4702TCE", UR, "C25792"),
    ("R", "100k", R0402): ("0402WGF1003TCE", UR, "C25741"),
    ("R", "100k 1%", R0402): ("0402WGF1003TCE", UR, "C25741"),
    ("R", "162k 1%", R0402): ("0402WGF1623TCE", UR, "C54068"),
    ("R", "374k 1%", R0402): ("0402WGF3743TCE", UR, "C25781"),
    ("R", "390k", R0402): ("0402WGF3903TCE", UR, "C25782"),
    ("R", "33", R0805): ("0805W8F330JT5E", UR, "C17634"),
    # Capacitors
    ("C", "18p", C0402): ("CL05C180JB5NNNC", SAM, "C307443"),
    ("C", "33p", C0402): ("CL05C330JB5NNNC", SAM, "C70465"),
    ("C", "68p", C0402): ("GRM1555C1H680JA01D", MUR, "C76977"),
    ("C", "100p", C0402): ("GRM1555C1H101JA01D", MUR, "C77177"),
    ("C", "1n", C0402): ("GRM1555C1H102JA01D", MUR, "C76947"),
    ("C", "100n", C0402): ("CL05B104KO5NNNC", SAM, "C1525"),
    ("C", "1u", C0402): ("CL05A105KA5NQNC", SAM, "C52923"),
    ("C", "1u 25V", C0603): ("CL10A105KA8NNNC", SAM, "C5673"),
    ("C", "4.7u", C0603): ("CL10A475KO8NNNC", SAM, "C19666"),
    ("C", "10u", C0603): ("CL10A106KP8NNNC", SAM, "C19702"),
    ("C", "22u", C0603): ("CL10A226MQ8NRNC", SAM, "C59461"),
    ("C", "47u", C1206): ("CL31A476MQHNNNE", SAM, "C68361"),
    # Inductors
    ("L", "5.1n", L0402): ("LQW15AN5N1C00D", MUR, "C113117"),
    ("L", "11n", L0402): ("LQW15AN11NG00D", MUR, "C113109"),
    ("L", "68n", L0402): ("LQW15AN68NJ00D", MUR, "C98065"),
}

SIN_PARTE = {"DNP"}  # tuning places with no value yet


def completar(sheets) -> None:
    """Fill MPN, manufacturer and LCSC of the generic passives that do not name their part."""
    missing = []
    for sheet in sheets:
        for group in sheet.groups:
            for p in group.parts:
                if p.kind != "part" or p.symbol not in ("R", "C", "L") or p.mpn or p.value in SIN_PARTE:
                    continue
                key = (p.symbol, p.value, p.footprint)
                if key not in PASIVOS:
                    missing.append(f"{sheet.name}: {p.symbol} {p.value} {p.footprint}")
                    continue
                p.mpn, p.manufacturer, p.lcsc = PASIVOS[key]
    if missing:
        raise SystemExit("Pasivos sin parte en catalogo.PASIVOS:\n  " + "\n  ".join(missing))
