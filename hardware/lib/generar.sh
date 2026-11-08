#!/usr/bin/env bash
# Genera símbolos, footprints y modelos 3D de la librería del pod desde LCSC/EasyEDA.
# Uso: bash hardware/lib/generar.sh (desde cualquier carpeta del repo).
# Después, verificar cada footprint contra la hoja del fabricante (ver README.md).
set -euo pipefail

# Versión fijada de easyeda2kicad (PyPI, última al 2026-11-07).
EASYEDA2KICAD_VERSION=1.0.1

cd "$(git rev-parse --show-toplevel)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

python3 -m venv "$tmp/venv"
"$tmp/venv/bin/pip" install --quiet "easyeda2kicad==${EASYEDA2KICAD_VERSION}"

parts=(
  C5119772  # Raytac MDBT50Q-P1MV2 (nRF52840, antena PCB)
  C965840   # XINGLIGHT XL-1615RGBC-RF (LED RGB)
  C411293   # Ebyte E22-900M22S (SX1262)
  C26633007 # ST LSM6DSV320X
  C5362283  # Bosch BMP581
  C3232508  # Infineon DPS368 (sin montar)
  C3010298  # Winbond W25N02KVZEIR (la W25N04KV del diseño usa el mismo footprint WSON-8; su número LCSC no se encontró)
  C3682423  # TI BQ25180
  C2682616  # Analog Devices MAX17048G+T10
  C2655033  # TI DRV5032FBDBZR (Hall del chaleco)
)

for part in "${parts[@]}"; do
  "$tmp/venv/bin/easyeda2kicad" --full --lcsc_id="$part" --output hardware/lib/pod --overwrite
done

# Solo el modelo 3D: el footprint sale de la hoja del fabricante (../tools/footprints_hoja.py) y
# referencia estos modelos.
model_parts=(
  C22403415 # Quectel LC29HAAMD
  C2680319  # TI TPS22916CYFPR (DSBGA-4)
  C3662799  # TI TPS259470ARPWR (VQFN-HR-10)
  C1518762  # TI TPS63900DSKR (WSON-10)
  C579465   # Analog Devices ADXL372BCCZ-RL7 (LGA-16)
  C5556161  # Qualcomm RF360 B39162B8389P810 (SAW L1 + L5, candidato)
  C18337445 # Infineon BGA525N6 (LNA L1/L2/L5, candidato)
)
for part in "${model_parts[@]}"; do
  "$tmp/venv/bin/easyeda2kicad" --3d --lcsc_id="$part" --output hardware/lib/pod --overwrite
done

# easyeda2kicad guarda la ruta absoluta de cada modelo 3D. Se reemplaza por una ruta
# relativa al proyecto, para que funcione en cualquier máquina y en el CI.
# Según cómo se le pase --output, la ruta sale absoluta o relativa a la raíz del repo:
# se cubren los dos casos.
abs_3d="$PWD/hardware/lib/pod.3dshapes"
for footprint in hardware/lib/pod.pretty/*.kicad_mod; do
  [ -e "$footprint" ] || continue
  sed -i.bak -e "s|${abs_3d}|\${KIPRJMOD}/../lib/pod.3dshapes|g" \
    -e "s|model \"hardware/lib/pod.3dshapes/|model \"\${KIPRJMOD}/../lib/pod.3dshapes/|g" "$footprint"
  rm -f "$footprint.bak"
done

# easyeda2kicad marca algunos footprints solo SMD como through_hole (BGA y LGA): sin
# esto se caen del pick-and-place exportado solo SMD.
for footprint in hardware/lib/pod.pretty/*.kicad_mod; do
  [ -e "$footprint" ] || continue
  if ! grep -q "thru_hole" "$footprint"; then
    sed -i.bak "s/(attr through_hole)/(attr smd)/" "$footprint"
    rm -f "$footprint.bak"
  fi
done

echo "Listo. Verificar cada footprint contra su hoja antes de usarlo."
