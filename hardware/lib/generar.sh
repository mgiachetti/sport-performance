#!/usr/bin/env bash
# Genera símbolos, footprints y modelos 3D de la librería del pod desde LCSC/EasyEDA.
# Correr desde la raíz del repo: bash hardware/lib/generar.sh
# Después, verificar cada footprint contra la hoja del fabricante (ver README.md).
set -euo pipefail

venv="$(mktemp -d)/venv"
python3 -m venv "$venv"
"$venv/bin/pip" install --quiet easyeda2kicad

parts=(
  C356849   # Ebyte E73-2G4M08S1C (nRF52840)
  C411293   # Ebyte E22-900M22S (SX1262)
  C26633007 # ST LSM6DSV320X
  C5362283  # Bosch BMP581
  C3232508  # Infineon DPS368 (sin montar)
  C3010298  # Winbond W25N02KVZEIR
  C3682423  # TI BQ25180
  C2682616  # Analog Devices MAX17048G+T10
)

for part in "${parts[@]}"; do
  "$venv/bin/easyeda2kicad" --full --lcsc_id="$part" --output hardware/lib/pod --overwrite
done

echo "Listo. Verificar cada footprint contra su hoja antes de usarlo."
