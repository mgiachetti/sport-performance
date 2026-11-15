# Carcasa de prueba del pod v0

Carcasa de dos tapas y una guía de luz para la placa de 50 × 70 mm. Tiene forma de cuña: gruesa en la nuca, donde va el patch GNSS, y más fina hacia abajo. Sirve para mostrar el producto y probar el encastre y la mecánica. No es estanca: el cierre con tornillos no lleva junta todavía.

## Archivos

- `generar_carcasa.py`: genera los STL. Sin opciones saca la variante para nylon sinterizado (MJF o SLS) o resina; con `--fdm`, la de impresora de filamento. Los parámetros están al principio. Necesita numpy y scikit-image.
- `verificar_carcasa.py`: revisa que las tapas no se pisen y que nada choque con los componentes, mide la pared mínima y dibuja los cortes y las vistas. Su tabla `comp` guarda la ubicación propuesta de cada componente.
- `visor/`: `armar_visor.py` arma `visor.html`, un visor 3D sin dependencias que muestra la carcasa en nylon.
- `pod-v0-carcasa-vistas.png`, `pod-v0-carcasa-cortes.png` y `pod-v0-guia-de-luz.png`: vistas y cortes con los componentes superpuestos.
- Los STL y `visor.html` no se guardan en el repositorio: se regeneran con los scripts.

```sh
python3 generar_carcasa.py            # nylon sinterizado o resina
python3 generar_carcasa.py --fdm      # impresora de filamento
python3 generar_carcasa.py --fdm --volcar /tmp/campos.npz
POD_FDM=1 python3 verificar_carcasa.py /tmp/campos.npz /tmp/salida
python3 visor/armar_visor.py
```

La explicación de cada decisión está en [`docs/hardware/pod-v0-ubicacion-y-carcasa.md`](../../../docs/hardware/pod-v0-ubicacion-y-carcasa.md).

Cada variante trae tres piezas:

- Tapa inferior: cara contra el cuerpo. Lleva los tres postes de la placa, los cuatro tetones de cierre, el bloque de contactos y las guías de la celda.
- Tapa superior: lado del tackle. Lleva las guías del patch, la cámara del barómetro, la ranura del LED, las marcas en V y el rebaje del logo.
- Guía de luz: se imprime en material transparente y lleva la luz del LED hasta la ranura.

## Medidas

- Exterior: 55 × 75 mm. Espesor de 21,1 mm en la nuca y 16,6 mm en el extremo de abajo.
- Esquinas de radio 7,5 mm y bordes redondeados.
- Pared mínima de 1,8 mm.
- Las dos tapas suman unos 23,3 cm³: unos 24 g en PA12, unos 30 g en PETG y unos 25 g en ASA (estimado con relleno al 100 %).

## Imprimir en una impresora de filamento (FlashForge Adventurer 5M Pro)

- Material de las tapas: ASA para un acabado mate y resistente al calor, o PETG si se busca lo más fácil. PLA solo para una primera prueba de encastre.
- No usar filamentos con fibra de carbono (PLA-CF, PETG-CF): la fibra conduce y afecta a las antenas.
- El nylon no figura en la lista oficial de la impresora. Por temperatura (280 °C de boquilla) admite nylon sin carga que imprima a 270 °C o menos, con el filamento seco y adhesivo en la cama; va por cuenta de quien imprime. El nylon sinterizado queda para un servicio de impresión.
- Tapa inferior: tal como viene, con la cara del cuerpo sobre la cama. No necesita soportes: el borde de apoyo va en chaflán.
- Tapa superior: tal como viene, con la boca hacia abajo, para que la cara visible salga limpia. Necesita soportes solo por dentro; conviene usar soportes de árbol.
- Capa de 0,12 a 0,16 mm en la tapa superior, para que la pendiente no quede escalonada. 4 perímetros y relleno del 40 % o más.
- Guía de luz: PETG transparente, relleno al 100 %, capa de 0,12 mm, con borde de adherencia. Viene parada sobre su cara de atrás y no necesita soportes.

## Diferencias de la variante de filamento

- Más juego en la unión entre tapas (0,25 mm) y en la guía de luz (0,2 mm).
- Sin cordón de encastre a presión: con filamento no sale fiable y los cuatro tornillos ya cierran.
- Agujeros más grandes, porque impresos quedan más chicos: 2,5 mm (paso), 1,8 mm (piloto), 1,7 mm (pines) y 1,8 mm (ventilación).
- Borde de la cara del cuerpo en chaflán a 45°, en lugar de redondeado.

## Cambios que le pide a la placa

- Esquinas del contorno con radio 5 mm.
- Una muesca cóncava de radio 2,7 mm en cada esquina, centrada a 2,6 mm de cada borde, para el tetón del tornillo de cierre.
- Tornillos de la placa de arriba corridos a (6; 8) y (44; 8). El de abajo sigue en (25; 66).
- Antena LoRa en la placa desde el 15/11/2026 (antena chip KYOCERA AVX M620720 en el borde de abajo, con su despeje de x = 28,1 a 44,1 y de y = 59,05 a 70): la carcasa no lleva FPC ni se alarga.
- Ra-01SH subido al lugar del DWM3000, que salió de la placa: queda de x = 31 a 48 y de y = 39 a 55. El U.FL de LoRa queda como puerto de prueba sin montar, debajo del Ra-01SH.
- Sensor Hall en (46; 42), en la cara de abajo y fuera de la celda: el imán del chaleco cambia de lugar.

## Armado

1. Colocar con calor los 3 insertos de bronce en los postes de la tapa inferior.
2. Pegar los 5 pines de contacto en el bloque de la tapa inferior.
3. Pegar la guía de luz en la tapa superior, metiéndola desde adentro hasta que la lengua asome por la ranura.
4. Pegar la membrana en el rebaje de la ventilación y la espuma en el borde de la cámara del barómetro.
5. Apoyar la celda con su espuma en la tapa inferior y enchufarla a la placa.
6. Atornillar la placa a los postes con los 3 tornillos M2 × 5.
7. Cerrar con los 4 tornillos M2 × 12 desde la cara del cuerpo. Roscan 4 mm en la tapa superior.

## Herrajes

- 3 tornillos M2 × 5 y 3 insertos de bronce M2 para agujero de 3,2 mm, para la placa.
- 4 tornillos M2 × 12 autorroscantes para plástico, de cabeza botón, para el cierre.
- 5 pines de contacto con vástago de 1,5 mm y cabeza de 2,5 mm, a 3,5 mm de paso.
- 5 contactos de resorte en la placa, de unos 2,5 mm de alto de trabajo.
- Membrana adhesiva de ePTFE de 4 mm para la ventilación del barómetro.
- Si los tornillos de acero desafinan las antenas, se pueden cambiar por tornillos M2 de nylon.

## Sin verificar

- No está impresa ni probada.
- Las posiciones salen de la propuesta del 14/11/2026, con los cambios de la antena LoRa del 15/11/2026 (`docs/hardware/pod-v0-ubicacion-y-carcasa.md`), no del KiCad.
- Los herrajes son medidas genéricas: hay que ajustarlas a las partes reales.
- Falta la altura del escalón del patch (DXF de Taoglas) para sumar el apoyo de presión vertical.
- Los juegos de la variante de filamento son un punto de partida: se ajustan con la primera impresión.
- Cuánta luz llega a la ranura depende del material transparente; hay que probarlo con el LED real.
- Los tornillos de las esquinas de abajo quedan cerca de la antena BLE y de la antena LoRa (el de la derecha, a unos 2,3 mm del borde del despeje): hay que medir con tornillos de acero y de nylon.
