"""Controlled-impedance geometry of the pod v0 (B-909): 50 ohm CPWG and 90 ohm USB pair on L1 over L2.

Standard library only. Prints the impedance of the geometry written in pod-v0.kicad_pro and
pod-v0.kicad_dru, plus a small sweep, so the numbers can be checked against PCBWay's impedance
calculator (or KiCad's PCB Calculator) once PCBWay confirms the real stack-up.

Formulas:
- Conductor-backed coplanar waveguide (CPWG, ground on L1 and L2): quasi-static conformal mapping
  (Ghione and Naldi 1984; Wadell, "Transmission Line Design Handbook" 1991, section 3.4.3) with
  Wadell's thickness correction, the model of KiCad's PCB Calculator (Transcalc); not yet compared
  against that calculator.
- Microstrip: Hammerstad and Jensen 1980, with their thickness correction.
- Edge-coupled microstrip, differential: IPC-2141A, Zdiff = 2 Z0 (1 - 0.48 exp(-0.96 s / h)).
- Solder mask on the CPWG (estimate): one more partial capacitance for a layer of thickness tm and
  permittivity em over the line, 2 e0 (em - 1) K(km) / K(km'), km = sinh(pi W / 4 tm) /
  sinh(pi (W + 2 S) / 4 tm) (Gevorgian et al. 1995, partial-capacitance method for layered CPW).
  It treats the mask as a flat layer of the thickness over the copper; the real mask is thicker in
  the gaps, so the real drop is probably a bit larger. The pair is printed without the mask.
The final geometry and permittivity come from PCBWay's field solver (Polar SI9000), not from here.

    python3 hardware/tools/impedancia.py
"""

from __future__ import annotations

import math

# Stack-up placeholder in pod-v0.kicad_pcb (not verified against PCBWay).
H_MM = 0.2  # prepreg L1-L2
ER = 4.4  # FR4 prepreg (7628), about 1 GHz
T_MM = 0.035  # L1 copper after plating (1 oz)
MASK_MM = 0.02  # LPI solder mask over the copper (typical; not verified)
MASK_ER = 3.5  # LPI solder mask (typical 3.3-4.0; not verified)

# Geometry chosen (written in the board setup and the custom rules).
RF_W_MM, RF_GAP_MM = 0.33, 0.20
USB_W_MM, USB_GAP_MM = 0.25, 0.15


def ellip_k(k: float) -> float:
    """Complete elliptic integral of the first kind K(k), by the arithmetic-geometric mean."""
    a, b = 1.0, math.sqrt(1 - k * k)
    for _ in range(40):
        a, b = (a + b) / 2, math.sqrt(a * b)
    return math.pi / (2 * a)


def _kk(k: float) -> float:
    """K(k) / K(k') with k' = sqrt(1 - k^2)."""
    if k < 1e-4:  # k' rounds to 1 in floating point: K(k) ~ pi / 2, K(k') ~ ln(4 / k)
        return (math.pi / 2) / math.log(4 / k)
    return ellip_k(k) / ellip_k(math.sqrt(1 - k * k))


def cpwg_ohm(w_mm: float, gap_mm: float, h_mm: float = H_MM, er: float = ER, t_mm: float = T_MM,
             mask_mm: float = 0.0, mask_er: float = MASK_ER) -> tuple[float, float]:
    """Z0 (ohm) and effective permittivity of a coplanar waveguide over a ground plane.

    Without mask, the model of KiCad's PCB Calculator ("Coplanar wave guide with ground plane",
    from Transcalc). With mask_mm > 0, adds the mask as a partial capacitance (estimate).
    """
    k1 = w_mm / (w_mm + 2 * gap_mm)
    k3 = math.tanh(math.pi * w_mm / (4 * h_mm)) / math.tanh(math.pi * (w_mm + 2 * gap_mm) / (4 * h_mm))
    q1, q3 = _kk(k1), _kk(k3)
    if t_mm > 0:
        d = (t_mm * 1.25 / math.pi) * (1 + math.log(4 * math.pi * w_mm / t_mm))
        q1 = _kk(k1 + (1 - k1 * k1) * d / 2 / gap_mm)
    qz = 1 / (q1 + q3)
    e_eff = 1 + q3 * qz * (er - 1)
    if t_mm > 0:
        e_eff -= (0.7 * (e_eff - 1) * t_mm / gap_mm) / (q1 + 0.7 * t_mm / gap_mm)
    if mask_mm > 0:
        km = math.sinh(math.pi * w_mm / (4 * mask_mm)) / math.sinh(math.pi * (w_mm + 2 * gap_mm) / (4 * mask_mm))
        e_eff += (mask_er - 1) * _kk(km) * qz
    return 60 * math.pi / math.sqrt(e_eff) * qz, e_eff


def microstrip_ohm(w_mm: float, h_mm: float = H_MM, er: float = ER, t_mm: float = T_MM) -> tuple[float, float]:
    """Z0 (ohm) and effective permittivity of a microstrip (Hammerstad and Jensen)."""
    if t_mm > 0:
        coth = 1 / math.tanh(math.sqrt(6.517 * w_mm / h_mm))
        w_mm = w_mm + (t_mm / math.pi) * math.log(1 + 4 * math.e / (t_mm / h_mm * coth**2))
    u = w_mm / h_mm
    a = 1 + math.log((u**4 + (u / 52) ** 2) / (u**4 + 0.432)) / 49 + math.log(1 + (u / 18.1) ** 3) / 18.7
    b = 0.564 * ((er - 0.9) / (er + 3)) ** 0.053
    e_eff = (er + 1) / 2 + (er - 1) / 2 * (1 + 10 / u) ** (-a * b)
    f = 6 + (2 * math.pi - 6) * math.exp(-((30.666 / u) ** 0.7528))
    z0 = 60 * math.log(f / u + math.sqrt(1 + 4 / u**2))
    return z0 / math.sqrt(e_eff), e_eff


def diff_microstrip_ohm(w_mm: float, gap_mm: float, h_mm: float = H_MM, er: float = ER, t_mm: float = T_MM) -> float:
    """Differential impedance (ohm) of an edge-coupled microstrip pair (IPC-2141A)."""
    z0, _ = microstrip_ohm(w_mm, h_mm, er, t_mm)
    return 2 * z0 * (1 - 0.48 * math.exp(-0.96 * gap_mm / h_mm))


def main() -> None:
    print(f"Stack-up: h = {H_MM} mm, er = {ER}, t = {T_MM} mm (not verified against PCBWay)")
    print(f"Solder mask estimate: {MASK_MM} mm, er = {MASK_ER} (not verified)")
    z, e = cpwg_ohm(RF_W_MM, RF_GAP_MM)
    zm, em = cpwg_ohm(RF_W_MM, RF_GAP_MM, mask_mm=MASK_MM)
    print(f"RF_50  CPWG   w = {RF_W_MM} mm, gap = {RF_GAP_MM} mm: Z0 = {z:.1f} ohm without mask (e_eff {e:.2f}), "
          f"{zm:.1f} ohm with mask (e_eff {em:.2f})")
    print(f"USB_90D pair  w = {USB_W_MM} mm, gap = {USB_GAP_MM} mm: Zdiff = {diff_microstrip_ohm(USB_W_MM, USB_GAP_MM):.1f} ohm")
    gaps = (0.15, 0.20, 0.25)
    for title, mask in (("without mask", 0.0), ("with mask", MASK_MM)):
        print(f"\nCPWG sweep {title} (Z0 in ohm):")
        print("  w \\ gap " + "".join(f"{g:>8.2f}" for g in gaps))
        for w in (0.30, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36):
            print(f"  {w:8.2f}" + "".join(f"{cpwg_ohm(w, g, mask_mm=mask)[0]:8.1f}" for g in gaps))
    print("\nUSB pair sweep (Zdiff in ohm):")
    print("  w \\ gap " + "".join(f"{g:>8.2f}" for g in gaps))
    for w in (0.15, 0.18, 0.20, 0.22, 0.25):
        print(f"  {w:8.2f}" + "".join(f"{diff_microstrip_ohm(w, g):8.1f}" for g in gaps))


if __name__ == "__main__":
    main()
