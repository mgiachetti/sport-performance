"""Small declarative model for the schematic: parts, groups and sheets."""

from __future__ import annotations

from dataclasses import dataclass, field

NC = "NC"  # pin left unconnected (gets a no-connect marker)

# Official KiCad footprints (names checked against kicad-footprints tag 10.0.8).
R0402 = "Resistor_SMD:R_0402_1005Metric"
R0805 = "Resistor_SMD:R_0805_2012Metric"
C0402 = "Capacitor_SMD:C_0402_1005Metric"
C0603 = "Capacitor_SMD:C_0603_1608Metric"
C1206 = "Capacitor_SMD:C_1206_3216Metric"
L0402 = "Inductor_SMD:L_0402_1005Metric"
SOT23 = "Package_TO_SOT_SMD:SOT-23"
SOT23_5 = "Package_TO_SOT_SMD:SOT-23-5"
SOT23_6 = "Package_TO_SOT_SMD:SOT-23-6"
SOD323 = "Diode_SMD:D_SOD-323"
SOD123F = "Diode_SMD:D_SOD-123F"
SOD882 = "Diode_SMD:D_SOD-882"
D0402 = "Diode_SMD:D_0402_1005Metric"
TP_PAD = "TestPoint:TestPoint_Pad_D1.0mm"
UFL = "Connector_Coaxial:U.FL_Hirose_U.FL-R-SMT-1_Vertical"
JUMPER_CLOSED = "Jumper:SolderJumper-2_P1.3mm_Bridged_Pad1.0x1.5mm"


@dataclass
class Part:
    symbol: str
    value: str
    nets: dict
    footprint: str = ""
    dnp: bool = False
    mpn: str = ""
    lcsc: str = ""
    manufacturer: str = ""
    note: str = ""
    ref: str = ""  # assigned by the generator (per sheet, in declaration order)
    kind: str = "part"  # "part" or "flag" (PWR_FLAG block)


@dataclass
class Group:
    title: str
    parts: list
    notes: list = field(default_factory=list)
    width: float = 0  # optional preferred width in mm


@dataclass
class Sheet:
    name: str  # file stem, matches the stub in pod-v0.kicad_sch
    title: str
    comment: str
    base: int  # reference numbers start here (R101, C101...)
    groups: list


def part(symbol, value, nets, footprint="", **kw) -> Part:
    return Part(symbol, value, dict(nets), footprint, **kw)


def R(value, a, b, footprint=R0402, **kw) -> Part:
    return Part("R", value, {"1": a, "2": b}, footprint, **kw)


def R0(a, b, note="", **kw) -> Part:
    """0 Ω jumper (rescue, current measurement or option select)."""
    return Part("R", "0", {"1": a, "2": b}, kw.pop("footprint", R0402), note=note, **kw)


def C(value, a, b="GND", footprint=C0402, **kw) -> Part:
    return Part("C", value, {"1": a, "2": b}, footprint, **kw)


def L(value, a, b, footprint=L0402, **kw) -> Part:
    return Part("L", value, {"1": a, "2": b}, footprint, **kw)


def D(value, anode, cathode, footprint=SOD323, symbol="D", **kw) -> Part:
    return Part(symbol, value, {"2": anode, "1": cathode}, footprint, **kw)


def ESD(value, line, footprint=SOD882, **kw) -> Part:
    return Part("D_ESD", value, {"1": line, "2": "GND"}, footprint, **kw)


def TP(net, **kw) -> Part:
    return Part("TestPoint", net, {"1": net}, TP_PAD, **kw)


def NMOS(gate, drain, source="GND", **kw) -> Part:
    kw.setdefault("note", "NMOS de nivel lógico AO3400A: Vgs(th) de 0,65–1,45 V, 48 mΩ con 2,5 V de gate")
    kw.setdefault("mpn", "AO3400A")
    kw.setdefault("manufacturer", "Alpha & Omega Semiconductor")
    kw.setdefault("lcsc", "C20917")
    return Part("Q_NMOS_GSD", "AO3400A", {"1": gate, "3": drain, "2": source}, SOT23, **kw)


def FLAG(net) -> Part:
    """PWR_FLAG on a rail whose source is not a power-output pin (connector, 0 Ω, switch)."""
    return Part("PWR_FLAG", "PWR_FLAG", {"1": net}, kind="flag")
