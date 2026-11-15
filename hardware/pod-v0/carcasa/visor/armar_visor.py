#!/usr/bin/env python3
"""Arma visor.html: las mallas de la carcasa embebidas y un visor WebGL sin dependencias."""
import os, re, sys, base64, json
import numpy as np
from scipy.ndimage import map_coordinates
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
import generar_carcasa as g

def normales_con_aristas(v, f, gn=None, grados=38.0):
    """Normales por esquina: promedia solo las caras vecinas con angulo menor al umbral."""
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    fn = np.cross(b - a, c - a); area = np.linalg.norm(fn, axis=1); fn /= np.maximum(area, 1e-12)[:, None]
    def ang(p, q, r):
        u, w = q - p, r - p
        cs = (u * w).sum(1) / np.maximum(np.linalg.norm(u, axis=1) * np.linalg.norm(w, axis=1), 1e-12)
        return np.arccos(np.clip(cs, -1, 1))
    wt = np.stack([ang(a, b, c), ang(b, c, a), ang(c, a, b)], 1)
    orden = np.argsort(f.ravel(), kind='stable'); vs = f.ravel()[orden]
    ini = np.searchsorted(vs, np.arange(len(v))); fin = np.searchsorted(vs, np.arange(len(v)), 'right')
    cara, esq = orden // 3, orden % 3
    cn = np.zeros((len(f), 3, 3)); cmin = np.cos(np.radians(grados))
    plano = np.zeros((len(f), 3), bool); cplano = np.cos(np.radians(1.5))
    for k in range(len(v)):
        cs, es = cara[ini[k]:fin[k]], esq[ini[k]:fin[k]]
        n = fn[cs]; w = wt[cs, es][:, None] * n
        dd = n @ n.T; m = dd > cmin
        plano[cs, es] = np.where(m, dd, 1.0).min(1) > cplano
        r = m @ w
        cn[cs, es] = r / np.maximum(np.linalg.norm(r, axis=1), 1e-12)[:, None]
    if gn is not None:   # en las zonas lisas vale la normal exacta del campo; en las aristas, la de las caras
        usados = 0
        for e in range(3):
            m = ((fn * gn[f[:, e]]).sum(1) > np.cos(np.radians(25.0))) & ~plano[:, e]
            cn[m, e] = gn[f[m, e]]; usados += int(m.sum())
        print('  esquinas con normal del campo: %.0f %%' % (100.0 * usados / (3 * len(f))))
    q = np.round(cn * 127).astype(np.int8)
    clave = np.concatenate([f.reshape(-1, 1).astype(np.int64), q.reshape(-1, 3).astype(np.int64) + 128], 1)
    clave = clave[:, 0] * 2**24 + clave[:, 1] * 2**16 + clave[:, 2] * 2**8 + clave[:, 3]
    _, prim, inv = np.unique(clave, return_index=True, return_inverse=True)
    return v[f.ravel()[prim]], q.reshape(-1, 3)[prim], inv.reshape(-1, 3).astype(np.uint32)

def cilindro(p0, p1, r, n=28):
    p0, p1 = np.array(p0, float), np.array(p1, float); ax = p1 - p0; ax /= np.linalg.norm(ax)
    u = np.cross(ax, [0, 0, 1.0] if abs(ax[2]) < 0.9 else [1.0, 0, 0]); u /= np.linalg.norm(u); w = np.cross(ax, u)
    t = np.linspace(0, 2 * np.pi, n, endpoint=False); ring = np.cos(t)[:, None] * u + np.sin(t)[:, None] * w
    V, N, F = [], [], []
    for i in range(n):
        j = (i + 1) % n; b = len(V)
        V += [p0 + r * ring[i], p0 + r * ring[j], p1 + r * ring[j], p1 + r * ring[i]]; N += [ring[i], ring[j], ring[j], ring[i]]
        F += [[b, b + 1, b + 2], [b, b + 2, b + 3]]
    for p, s in ((p0, -1), (p1, 1)):
        b = len(V); V.append(p); N.append(s * ax)
        for i in range(n):
            V.append(p + r * ring[i]); N.append(s * ax)
        for i in range(n):
            j = (i + 1) % n
            F.append([b, b + 1 + j, b + 1 + i] if s < 0 else [b, b + 1 + i, b + 1 + j])
    return np.array(V), np.array(N), np.array(F, np.uint32)

def caja(x0, x1, y0, y1, z0, z1):
    V, N, F = [], [], []
    for ax, s in ((0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)):
        lim = [(x0, x1), (y0, y1), (z0, z1)]; o = [a for a in range(3) if a != ax]
        fijo = lim[ax][0 if s < 0 else 1]; n = np.zeros(3); n[ax] = s; b = len(V)
        for i, j in ((0, 0), (1, 0), (1, 1), (0, 1)):
            p = np.zeros(3); p[ax] = fijo; p[o[0]] = lim[o[0]][i]; p[o[1]] = lim[o[1]][j]; V.append(p); N.append(n)
        q = [[b, b + 1, b + 2], [b, b + 2, b + 3]]
        if np.dot(np.cross(V[b + 1] - V[b], V[b + 2] - V[b]), n) < 0:
            q = [[b, b + 2, b + 1], [b, b + 3, b + 2]]
        F += q
    return np.array(V), np.array(N), np.array(F, np.uint32)

def unir(piezas):
    V, N, F, o = [], [], [], 0
    for v, n, f in piezas:
        V.append(v); N.append(n); F.append(f + o); o += len(v)
    return np.concatenate(V), np.concatenate(N), np.concatenate(F)

inf, sup = g.construir()[:2]
partes = []
for nombre, sdf, grupo in (('inferior', inf, 0), ('superior', sup, 1)):
    v, f = g.malla(sdf); v, f = g.simplificar(v, f)
    grad = np.stack([map_coordinates(c, ((v - np.array([g.xs[0], g.ys[0], g.zs[0]])) / g.PASO).T, order=1)
                     for c in np.gradient(sdf, g.PASO)], 1)
    grad /= np.maximum(np.linalg.norm(grad, axis=1), 1e-9)[:, None]
    p, n, i = normales_con_aristas(v, f, grad)
    partes.append(dict(nombre=nombre, grupo=grupo, mat=0, p=p, n=n.astype(np.float64) / 127, i=i))
    print(nombre, len(p), 'vertices', len(i), 'triangulos')
zi = g.ZB + g.ISLA[4]
pines = unir([cilindro((x, g.PINES_Y, zi + 0.55), (x, g.PINES_Y, zi + 0.05), 1.22) for x in g.PINES_X])
partes.append(dict(nombre='pines', grupo=0, mat=1, p=pines[0], n=pines[1], i=pines[2]))
r = g.LED_ALTO / 2 - 0.04
luz = unir([caja(g.LED_X - g.LED_ANCHO / 2 + r, g.LED_X + g.LED_ANCHO / 2 - r, g.Y0 + 0.12, g.CY0, g.LED_Z - r, g.LED_Z + r),
            cilindro((g.LED_X - g.LED_ANCHO / 2 + r + 0.04, g.Y0 + 0.12, g.LED_Z), (g.LED_X - g.LED_ANCHO / 2 + r + 0.04, g.CY0, g.LED_Z), r),
            cilindro((g.LED_X + g.LED_ANCHO / 2 - r - 0.04, g.Y0 + 0.12, g.LED_Z), (g.LED_X + g.LED_ANCHO / 2 - r - 0.04, g.CY0, g.LED_Z), r)])
partes.append(dict(nombre='guia de luz', grupo=1, mat=2, p=luz[0], n=luz[1], i=luz[2]))
cab = unir([cilindro((x, y, g.Z_ASIENTO - 0.02), (x, y, g.Z_ASIENTO - 1.3), 1.75) for x, y in g.CIERRE])
partes.append(dict(nombre='tornillos de cierre', grupo=0, mat=4, p=cab[0], n=cab[1], i=cab[2]))
xm = g.X1 - g.PROF_MEMBRANA
mem = cilindro((xm - 0.05, g.BARO[1], g.Z_VENT), (xm + 0.18, g.BARO[1], g.Z_VENT), g.R_MEMBRANA - 0.1)
partes.append(dict(nombre='membrana', grupo=1, mat=3, p=mem[0], n=mem[1], i=mem[2]))

todo = np.concatenate([d['p'] for d in partes]); lo, hi = todo.min(0), todo.max(0)
centro = (np.array([g.X0, g.Y0, g.ZB]) + np.array([g.X1, g.Y1, g.Z_TECHO + g.TECHO])) / 2
escala = float(np.abs(todo - centro).max() * 1.001)
b64 = lambda a: base64.b64encode(a.tobytes()).decode()
datos = dict(escala=escala, partes=[dict(nombre=d['nombre'], grupo=d['grupo'], mat=d['mat'],
             p=b64(np.round((d['p'] - centro) / escala * 32767).astype('<i2')),
             n=b64(np.round(np.clip(d['n'], -1, 1) * 127).astype(np.int8)),
             i=b64(d['i'].astype('<u4'))) for d in partes])
# Prettier formats the template and writes the placeholder as "/*DATOS*/ null": accept both.
plantilla = open(os.path.join(AQUI, 'plantilla.html')).read()
html, n = re.subn(r'/\*DATOS\*/\s*null', lambda _: json.dumps(datos, separators=(',', ':')), plantilla)
if n != 1:
    sys.exit('plantilla.html: falta el marcador /*DATOS*/ null')
open(os.path.join(AQUI, 'visor.html'), 'w').write(html)
print('visor.html: %.2f MB' % (len(html) / 1e6))
