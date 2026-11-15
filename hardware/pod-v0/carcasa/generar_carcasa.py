#!/usr/bin/env python3
"""Carcasa de prueba del pod v0 (placa de 50 x 70 mm con esquinas de radio 5) para imprimir en 3D.

Forma de cuña: gruesa en la nuca, donde va el patch GNSS, y mas fina hacia abajo.

Genera dos STL (tapa inferior y tapa superior) a partir de campos de distancia
y marching cubes. Solo necesita numpy y scikit-image.

Sistema de la placa: x de 0 a 50, y de 0 a 70 (y = 0 es el borde de la nuca),
z = 0 en la cara de abajo de la placa y +z hacia el patch (lado del tackle).
Todas las medidas en mm. Cambiar los parametros de abajo y volver a correr.
"""
import os, struct, sys
import numpy as np
from skimage import measure

# ---------- parametros ----------
PASO = 0.25                      # resolucion de la malla
PCB_X, PCB_Y, PCB_T = 50.0, 70.0, 1.6
HOLGURA = 0.5                    # entre la placa y la pared
PARED = 2.0                      # paredes laterales
TECHO = 1.8                      # espesor de la cara de arriba y de la de abajo
Z_TECHO = 10.5                   # cara interna de arriba sobre el patch (1,6 + 8,12 + 0,4 de tolerancia)
Z_TECHO_BAJO = 6.0               # cara interna de arriba en el extremo de abajo (Ra-01SH: 4,8)
Y_CUNA = (31.0, 62.0)            # tramo de y donde el techo baja de un valor al otro
Z_PISO = -7.0                    # cara interna de abajo (1 de despeje + celda de 5,2 + 0,8 de espuma)
R_ESQ, R_ESQ_INT = 7.5, 5.5      # radio de las esquinas verticales (afuera, adentro); la placa lleva radio 5
K_ARRIBA = (6.5, 2.6)            # redondeo del borde de arriba: en la nuca y en el extremo de abajo
K_ABAJO, K_ABAJO_INT = 3.5, 1.5  # redondeo del borde de la cara del cuerpo
K_DIF = 1.6                      # el redondeo interno de arriba es K_ARRIBA - K_DIF
R_TRABA, Z_TRABA, Y_TRABA = 0.4, 4.2, (12.0, 58.0)  # cordon de encastre a presion en los lados largos
Z_UNION, Z_SOLAPE = 3.5, 5.0     # union a media madera entre las dos tapas
J_RAD, J_VERT = 0.15, 0.2        # juego radial y vertical de la union

TORNILLOS = [(6.0, 8.0), (44.0, 8.0), (25.0, 66.0)]  # M2 x 5: sujetan solo la placa, desde adentro
R_POSTE = 3.0
R_INSERTO, PROF_INSERTO = 1.6, 4.5  # inserto de bronce M2 (agujero ciego de 3,2) en cada poste

PINES_X, PINES_Y = [18.0, 21.5, 25.0, 28.5, 32.0], 7.0  # VBUS, D+, D-, GND, DETECT (paso de 3,5)
R_PIN, R_PIN_CABEZA, PROF_PIN_CABEZA = 0.775, 1.3, 0.6      # vastago de 1,5 y cabeza de 2,5
BLOQUE = (15.0, 35.0, 3.5, 10.5)  # bloque del inserto de contactos
CIERRE = [(2.6, 2.6), (47.4, 2.6), (2.6, 67.4), (47.4, 67.4)]  # M2 x 12 de cabeza boton, desde la cara del cuerpo
R_TETON = 2.4                     # teton de cada esquina; la placa lleva una muesca de radio 2,7 alrededor
Z_ASIENTO, R_CABEZA, R_PASO = -5.9, 2.0, 1.15   # asiento de la cabeza, alojamiento de 4,0 y pasante de 2,3
Z_TETON_INF, Z_TETON_SUP = 1.9, 2.1             # donde termina el teton de abajo y empieza el de arriba
R_PILOTO, Z_PILOTO = 0.85, 6.6                  # agujero de 1,7 para tornillo autorroscante, ciego

Z_BLOQUE = -2.5                   # deja 2,5 mm para los resortes hasta la placa
ISLA = (14.5, 35.5, 4.8, 9.2, 0.3)  # rebaje alrededor de los pines en la cara del cuerpo (x0, x1, y0, y1, prof.)

CELDA = (12.0, 42.0, 14.0, 62.0)  # 503048: 5 x 30 x 48
J_CELDA, H_GUIA = 0.4, 1.5

PATCH_C, PATCH_HUECO = (25.0, 17.0), 26.2  # GVLB258.A de 25 x 25 +/- 0,4
Z_GUIA_PATCH = 4.5

BARO = (45.0, 20.0)               # BMP581
Z_VENT, R_VENT = 7.2, 0.75
R_MEMBRANA, PROF_MEMBRANA = 2.1, 0.9  # rebaje de asiento plano para una membrana adhesiva de 4 mm

LED_X, LED_Z, LED_ANCHO, LED_ALTO = 8.5, 7.0, 6.0, 1.6  # ranura de luz en la pared de la nuca

GALONES = [(25.0, 37.0), (25.0, 42.5)]  # vertices de las dos marcas en V (apuntan a la nuca)
GALON_BRAZO, GALON_ANCHO, GALON_PROF = (13.0, 7.0), 1.3, 0.4
LOGO = (25.0, 56.5, 7.0, 0.4)     # rebaje redondo para el logo del club (x, y, radio, prof.)

J_GUIA = 0.15                     # juego de la guia de luz dentro de la ranura
CHAFLAN = 0.0                     # si es mayor que 0, el borde de la cara del cuerpo va en chaflan a 45 grados

# ---------- variante para impresora de filamento (--fdm) ----------
FDM = "--fdm" in sys.argv or bool(os.environ.get("POD_FDM"))
if FDM:
    J_RAD, J_GUIA = 0.25, 0.2     # mas juego en la union y en la guia de luz
    R_TRABA = 0.0                 # sin cordon a presion: con filamento no sale fiable y los tornillos ya cierran
    CHAFLAN = 1.6                 # el borde que apoya en la cama sale sin soportes
    R_PIN, R_PASO, R_CABEZA, R_PILOTO = 0.85, 1.25, 2.15, 0.9   # los agujeros impresos quedan mas chicos
    R_VENT, R_MEMBRANA, PATCH_HUECO = 0.9, 2.2, 26.4

# ---------- derivados ----------
X0, X1 = -HOLGURA - PARED, PCB_X + HOLGURA + PARED
Y0, Y1 = -HOLGURA - PARED, PCB_Y + HOLGURA + PARED
ZB, ZT = Z_PISO - TECHO, Z_TECHO + TECHO
CX0, CX1, CY0, CY1 = -HOLGURA, PCB_X + HOLGURA, -HOLGURA, PCB_Y + HOLGURA

M = 1.0
xs = np.arange(X0 - M, X1 + M + PASO / 2, PASO, dtype=np.float32)
ys = np.arange(Y0 - M, Y1 + M + PASO / 2, PASO, dtype=np.float32)
zs = np.arange(ZB - M, ZT + M + PASO / 2, PASO, dtype=np.float32)
X, Y, Z = xs[:, None, None], ys[None, :, None], zs[None, None, :]

def U(*a):
    r = a[0]
    for b in a[1:]:
        r = np.minimum(r, b)
    return r

def I(*a):
    r = a[0]
    for b in a[1:]:
        r = np.maximum(r, b)
    return r

def rrect(x0, x1, y0, y1, r):
    qx = np.abs(X - (x0 + x1) / 2) - (x1 - x0) / 2 + r
    qy = np.abs(Y - (y0 + y1) / 2) - (y1 - y0) / 2 + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r

def extr(d2, z0, z1, re):
    wx = d2 + re
    wz = np.abs(Z - (z0 + z1) / 2) - (z1 - z0) / 2 + re
    return np.minimum(np.maximum(wx, wz), 0) + np.hypot(np.maximum(wx, 0), np.maximum(wz, 0)) - re

def caja(x0, x1, y0, y1, z0, z1):
    return I(x0 - X, X - x1, y0 - Y, Y - y1, z0 - Z, Z - z1)

def cilz(cx, cy, r, z0, z1):
    return I(np.hypot(X - cx, Y - cy) - r, z0 - Z, Z - z1)

def cilx(cy, cz, r, x0, x1):
    return I(np.hypot(Y - cy, Z - cz) - r, x0 - X, X - x1)

def cily(cx, cz, r, y0, y1):
    return I(np.hypot(X - cx, Z - cz) - r, y0 - Y, Y - y1)

def escuadra(cx, cy, sx, sy, largo, t, z0, z1):
    """L con el vertice en (cx, cy) y brazos hacia (sx, sy); el material queda hacia afuera."""
    a = caja(*sorted((cx - sx * t, cx)), *sorted((cy - sy * t, cy + sy * largo)), z0, z1)
    b = caja(*sorted((cx - sx * t, cx + sx * largo)), *sorted((cy - sy * t, cy)), z0, z1)
    return U(a, b)

def suave(a, b, k):
    """Interseccion con el borde redondeado (k es el ancho del redondeo)."""
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.maximum(a, b) + h * h * k * 0.25

def segmento(x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    t = np.clip(((X - x0) * dx + (Y - y0) * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(X - x0 - t * dx, Y - y0 - t * dy)

def envolvente():
    """Devuelve la forma de afuera, la cavidad y la altura del techo interno."""
    t = np.clip((Y - Y_CUNA[0]) / (Y_CUNA[1] - Y_CUNA[0]), 0, 1)
    baja = t * t * (3 - 2 * t)                      # 0 en la nuca, 1 en el extremo de abajo
    techo = Z_TECHO + (Z_TECHO_BAJO - Z_TECHO) * baja
    k_arr = K_ARRIBA[0] + (K_ARRIBA[1] - K_ARRIBA[0]) * baja
    lado = suave(rrect(X0, X1, Y0, Y1, R_ESQ), Z - (techo + TECHO), k_arr)
    if CHAFLAN > 0:
        exterior = I(lado, ZB - Z, (lado + (ZB - Z) + CHAFLAN) * 0.7071)
    else:
        exterior = suave(lado, ZB - Z, K_ABAJO)
    cavidad = suave(suave(rrect(CX0, CX1, CY0, CY1, R_ESQ_INT), Z - techo, k_arr - K_DIF), Z_PISO - Z, K_ABAJO_INT)
    return exterior, cavidad, techo

def construir():
    exterior, cavidad, techo = envolvente()
    cascara = I(exterior, -cavidad)
    medio = rrect(X0 + PARED / 2, X1 - PARED / 2, Y0 + PARED / 2, Y1 - PARED / 2, R_ESQ - PARED / 2)
    traba = lambda r: I(np.hypot(medio + J_RAD / 2, Z - Z_TRABA) - r, Y_TRABA[0] - Y, Y - Y_TRABA[1])
    zona_inf = U(Z - Z_UNION, I(Z - (Z_SOLAPE - J_VERT), J_RAD / 2 - medio))
    zona_sup = U(Z_SOLAPE - Z, I((Z_UNION + J_VERT) - Z, medio + J_RAD / 2))

    # ----- tapa inferior (cara contra el cuerpo) -----
    inf = I(cascara, zona_inf)
    inf = U(inf, *[cilz(x, y, R_POSTE, Z_PISO - 0.5, 0.0) for x, y in TORNILLOS])
    inf = U(inf, caja(*BLOQUE, Z_PISO - 0.5, Z_BLOQUE))
    cx0, cx1, cy0, cy1 = CELDA[0] - J_CELDA, CELDA[1] + J_CELDA, CELDA[2] - J_CELDA, CELDA[3] + J_CELDA
    for cx, sx in ((cx0, 1), (cx1, -1)):
        for cy, sy in ((cy0, 1), (cy1, -1)):
            inf = U(inf, escuadra(cx, cy, sx, sy, 6.0, 1.0, Z_PISO - 0.5, Z_PISO + H_GUIA))
    inf = U(inf, *[cilz(x, y, R_TETON, Z_PISO - 0.5, Z_TETON_INF) for x, y in CIERRE])
    inf = I(inf, exterior)
    for x, y in CIERRE:
        inf = I(inf, -cilz(x, y, R_PASO, Z_ASIENTO - 0.1, Z_TETON_INF + 1))
        inf = I(inf, -cilz(x, y, R_CABEZA, ZB - 1, Z_ASIENTO))
    for x, y in TORNILLOS:
        inf = I(inf, -cilz(x, y, R_INSERTO, -PROF_INSERTO, 1.0))
    ix0, ix1, iy0, iy1, ip = ISLA
    inf = I(inf, -I(rrect(ix0, ix1, iy0, iy1, (iy1 - iy0) / 2) + 0 * Z, Z - (ZB + ip)))
    for x in PINES_X:
        inf = I(inf, -cilz(x, PINES_Y, R_PIN, ZB - 1, Z_BLOQUE + 1))
        inf = I(inf, -cilz(x, PINES_Y, R_PIN_CABEZA, ZB - 1, ZB + ip + PROF_PIN_CABEZA))
    if R_TRABA > 0:
        inf = I(inf, -traba(R_TRABA + 0.05))

    # ----- tapa superior (lado del tackle) -----
    sup = I(cascara, zona_sup)
    h = PATCH_HUECO / 2
    for sx in (1, -1):
        for sy in (1, -1):
            sup = U(sup, escuadra(PATCH_C[0] - sx * h, PATCH_C[1] - sy * h, sx, sy, 6.0, 1.2,
                                  Z_GUIA_PATCH, Z_TECHO + 0.5))
    bx, by = BARO
    zc = Z_UNION + J_VERT
    camara = U(caja(bx - 2.5, CX1 + 0.5, by - 2.5, by + 2.5, zc, Z_TECHO + 0.5),
               caja(bx - 2.5, CX1 - J_RAD, by - 2.5, by + 2.5, PCB_T + 0.5, zc))
    hueco = U(caja(bx - 1.5, CX1, by - 1.5, by + 1.5, zc, Z_TECHO),
              caja(bx - 1.5, CX1 - J_RAD - 1.0, by - 1.5, by + 1.5, PCB_T, zc + 0.1))
    sup = U(sup, I(camara, -hueco))
    libre = rrect(CX0, CX1, CY0, CY1, R_ESQ_INT) + J_RAD   # por debajo de la union, el teton no toca la pared de abajo
    for x, y in CIERRE:
        sup = U(sup, cilz(x, y, R_TETON, zc, Z_TECHO + 0.5), I(cilz(x, y, R_TETON, Z_TETON_SUP, zc), libre))
    sup = I(sup, exterior)
    if R_TRABA > 0:
        sup = U(sup, traba(R_TRABA))
    for x, y in CIERRE:
        sup = I(sup, -cilz(x, y, R_PILOTO, Z_TETON_SUP - 1, Z_PILOTO))
    sup = I(sup, -cilx(by, Z_VENT, R_VENT, CX1 - 1.5, X1 + 1))
    sup = I(sup, -cilx(by, Z_VENT, R_MEMBRANA, X1 - PROF_MEMBRANA, X1 + 1))
    r = LED_ALTO / 2                                 # ranura de luz: dos semicirculos y un tramo recto
    ranura = np.hypot(np.maximum(np.abs(X - LED_X) - (LED_ANCHO / 2 - r), 0), Z - LED_Z) - r
    sup = I(sup, -I(ranura, Y0 - 1 - Y, Y - (CY0 + 1.5)))
    piel = (techo + TECHO - GALON_PROF) - Z          # negativo por encima de la piel de arriba
    for gx, gy in GALONES:
        for sx in (1, -1):
            sup = I(sup, -I(segmento(gx, gy, gx + sx * GALON_BRAZO[0], gy + GALON_BRAZO[1]) - GALON_ANCHO / 2, piel))
    lx, ly, lr, lp = LOGO
    sup = I(sup, -I(np.hypot(X - lx, Y - ly) - lr + 0 * Z, (techo + TECHO - lp) - Z))

    # ----- guia de luz: entra por dentro en la ranura y baja hasta quedar sobre el LED -----
    lengua = I(np.hypot(np.maximum(np.abs(X - LED_X) - (LED_ANCHO / 2 - r), 0), Z - LED_Z) - (r - J_GUIA),
               Y0 - 1 - Y, Y - 1.0, exterior + 0.1)
    cuerpo = I(caja(LED_X - 2.8, LED_X + 1.9, CY0 - 1.0, 3.6, PCB_T + 1.1, LED_Z + r + 1.2),
               cavidad + J_GUIA, (Y + Z - 8.6) * 0.7071)     # cara de atras a 45 grados, que manda la luz a la ranura
    guia = U(lengua, cuerpo)
    return inf, sup, guia

def malla(sdf):
    v, f, _, _ = measure.marching_cubes(sdf, 0.0, spacing=(PASO, PASO, PASO), gradient_direction="descent")
    v += np.array([xs[0], ys[0], zs[0]], dtype=np.float32)
    return v.astype(np.float64), f

def simplificar(v, f, pasadas=6):
    """Saca vertices de las zonas planas sin mover la superficie: un vertice se funde con un
    vecino solo si todos sus triangulos conservan la normal. Reduce el STL a una fraccion."""
    P = [tuple(map(float, p)) for p in v]
    F = [list(map(int, t)) for t in f]

    def normal(a, b, c):
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        wx, wy, wz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx, ny, nz = uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx
        l = (nx * nx + ny * ny + nz * nz) ** 0.5
        return nx, ny, nz, l

    N = []
    for a, b, c in F:
        nx, ny, nz, l = normal(P[a], P[b], P[c])
        l = l or 1.0
        N.append((nx / l, ny / l, nz / l))
    vf = [set() for _ in P]
    for i, t in enumerate(F):
        for k in t:
            vf[k].add(i)

    def vecinos(k):
        r = set()
        for i in vf[k]:
            r.update(F[i])
        r.discard(k)
        return r

    for _ in range(pasadas):
        hechos = 0
        for k in range(len(P)):
            caras = vf[k]
            if not caras:
                continue
            nk = vecinos(k)
            for u in nk:
                if len(nk & vecinos(u)) != 2:
                    continue
                ok = True
                for i in caras:
                    t = F[i]
                    if u in t:
                        continue
                    a, b, c = (P[u] if q == k else P[q] for q in t)
                    nx, ny, nz, l = normal(a, b, c)
                    if l < 1e-7:
                        ok = False
                        break
                    n0 = N[i]
                    if (nx * n0[0] + ny * n0[1] + nz * n0[2]) / l < 1 - 1e-9:
                        ok = False
                        break
                    m = max(sum((a[j] - b[j]) ** 2 for j in range(3)), sum((b[j] - c[j]) ** 2 for j in range(3)),
                            sum((c[j] - a[j]) ** 2 for j in range(3)))
                    if l < 0.02 * m:      # sin triangulos aguja
                        ok = False
                        break
                if not ok:
                    continue
                for i in list(caras):
                    t = F[i]
                    if u in t:
                        for q in t:
                            vf[q].discard(i)
                        F[i] = None
                    else:
                        t[t.index(k)] = u
                        vf[u].add(i)
                vf[k] = set()
                hechos += 1
                break
        if hechos < len(P) // 200:
            break
    vivos = [t for t in F if t is not None]
    usados = sorted({k for t in vivos for k in t})
    idx = {k: i for i, k in enumerate(usados)}
    return np.array([P[k] for k in usados]), np.array([[idx[k] for k in t] for t in vivos])

def volumen(v, f):
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)

def cerrada(f):
    e = np.sort(np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    _, n = np.unique(e, axis=0, return_counts=True)
    return bool((n == 2).all())

def guardar_stl(ruta, v, f):
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    n = np.cross(b - a, c - a)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    reg = np.zeros(len(f), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    reg["n"], reg["v"][:, 0], reg["v"][:, 1], reg["v"][:, 2] = n, a, b, c
    with open(ruta, "wb") as fh:
        fh.write(b"pod v0 carcasa".ljust(80, b" "))
        fh.write(struct.pack("<I", len(f)))
        fh.write(reg.tobytes())

if __name__ == "__main__":
    inf, sup, guia = construir()
    if "--volcar" in sys.argv:   # guarda los campos para revisar cortes
        np.savez_compressed(sys.argv[sys.argv.index("--volcar") + 1], inf=inf, sup=sup, guia=guia, xs=xs, ys=ys, zs=zs)
    suf = "-fdm" if FDM else ""
    # en nylon sinterizado la tapa superior va con la cara de afuera hacia abajo; con filamento, con la boca hacia abajo
    for nombre, sdf, girar in ((f"pod-v0-tapa-inferior{suf}.stl", inf, ""), (f"pod-v0-tapa-superior{suf}.stl", sup, "" if FDM else "x"),
                               (f"pod-v0-guia-de-luz{suf}.stl", guia, "guia")):
        v, f = malla(sdf)
        vol0, n0 = volumen(v, f), len(f)
        if "--sin-simplificar" not in sys.argv:
            v, f = simplificar(v, f)
            assert abs(volumen(v, f) - vol0) < 1e-3 * abs(vol0), "la simplificacion cambio el volumen"
        if girar == "x":      # giro de 180 grados sobre x: la cara de afuera queda sobre la cama
            v = v * np.array([1.0, -1.0, -1.0])
        elif girar == "guia":  # la cara de atras sobre la cama y la lengua hacia arriba
            v = np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)
        v -= v.min(axis=0)
        guardar_stl(nombre, v, f)
        d = v.max(axis=0)
        print(f"{nombre}: {d[0]:.1f} x {d[1]:.1f} x {d[2]:.1f} mm, {len(f)} triangulos (de {n0}), "
              f"{volumen(v, f) / 1000:.1f} cm3, cerrada={cerrada(f)}")
