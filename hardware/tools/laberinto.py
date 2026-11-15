"""Grid maze router for the nets that ``rutear.py criticas`` leaves (B-909). Used by ``rutear.py resto``.

Freerouting (2.5.0) did not finish this board: with the 0.5 mm of RF_50, the keep-outs of the antennas and the via
field of the BMD-340 it stalled at 150-190 unrouted connections after 40 passes. This router does the rest with the
board's own rules, all of them known here (it is not a general autorouter):

- a 0.05 mm grid on L1, L3 and L4 (L2 is the GND plane: only vias cross it), A* with 45-degree moves, a cost per via,
  L3 preferred over L4 and L4 over L1 (L1 keeps room for the pads), and a cost next to the pads of other nets;
- every copper item of another net blocks the cells closer than its clearance (its net class or pad, at least the
  0.15 mm of Default; RF_50 0.5 mm, and 0.15 mm inside the LNA's courtyard as the custom rule says) plus half the track
  and a margin for the grid; the routed net adds its own (GNSS_SENSITIVE 0.3 mm, POWER_DOCK 0.2 mm) and its width;
- the rule areas: nothing in BLE_ANTENA and LORA_ANTENA, no track on L1 and no via in GNSS_ANTENA, no track on L3 in
  L3_GND, the footprint keep-outs (the patch pin), nothing on L3 or L4 under the 32.768 kHz crystal, nothing of
  GNSS_SENSITIVE within 5 mm of the switch node, POWER_DOCK only on L1 and L4, 0.3 mm of copper to the edge;
- vias of 0.5/0.2 mm, never in a pad, at least 0.5 mm between via centres;
- GND is not routed (planes and `rutear.py planos`).

Each net is routed as a growing tree: the smallest group of connected copper to the nearest other one, until the net
is one group. When a connection has no free path, it is searched again allowing to cross what this router already
routed (at a cost): the nets in the way are ripped up and go back to the queue (rip-up and reroute, at most
``MAX_RIPS`` times per net). Deterministic: same board, same result.
"""

from __future__ import annotations

import heapq
import math
from array import array

import pcbnew

ORIGIN = (100.0, 100.0)
G = 0.05  # mm per cell
NX, NY = 1000, 1400  # 50 x 70 mm
MARGIN = 0.045  # grid error: a 45-degree step passes 0.035 mm from the cell centres
H0 = 0.075  # half the narrowest track (0.15 mm)
VIA = (0.5, 0.2)
VIA_PITCH = 0.5  # mm between via centres (hole to hole 0.3 mm)
VIA_COST = 24  # cells (1.2 mm)
LAYER_COST = (1.4, 1.0, 1.15)  # L1, L3, L4
HALO = 0.45  # mm around every pad
HALO_COST = 2.0
RIP_COST = 40.0  # per cell of routed copper crossed in a rip-up search
MAX_RIPS = 8
EXPAND = 400000

WIDTH = {"Default": 0.15, "GNSS_SENSITIVE": 0.15, "POWER": 0.25, "POWER_DOCK": 0.3}
EXTRA_CLEARANCE = {"GNSS_SENSITIVE": 0.15, "POWER_DOCK": 0.05}  # over the 0.15 mm of the grid
SKIP_CLASSES = {"RF_50", "USB_90D", "SW_NODE"}
STEPS = ((1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0),
         (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142))


def mm(v: float) -> int:
    return pcbnew.FromMM(v)


def cell_of(x_nm: int, y_nm: int) -> tuple[int, int]:
    return (round((pcbnew.ToMM(x_nm) - ORIGIN[0]) / G), round((pcbnew.ToMM(y_nm) - ORIGIN[1]) / G))


def nm_of(i: int, j: int) -> pcbnew.VECTOR2I:
    return pcbnew.VECTOR2I(mm(ORIGIN[0] + i * G), mm(ORIGIN[1] + j * G))


def disk(r: float) -> list:
    n = int(math.ceil(r / G))
    return [(di, dj) for di in range(-n, n + 1) for dj in range(-n, n + 1) if (di * di + dj * dj) * G * G <= r * r]


VIA_DISK = disk(VIA_PITCH - 0.001)


class Grid:
    def __init__(self, board):
        self.board = board
        self.layers = [pcbnew.F_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]
        n = NX * NY
        self.t = [array("i", bytes(4 * n)) for _ in self.layers]  # track centre: 0 free, net, -1 blocked
        self.v = [array("i", bytes(4 * n)) for _ in self.layers]  # via centre: same
        self.vs = array("b", bytes(n))  # within VIA_PITCH of a via centre
        self.halo = [array("b", bytes(n)) for _ in self.layers]
        self.gnd = board.FindNet("GND").GetNetCode()
        self.courtyard_lna = None
        for fp in board.GetFootprints():
            if fp.GetReference() == "U205":
                self.courtyard_lna = fp.GetCourtyard(pcbnew.F_CrtYd)
        self.sw = []  # switch-node copper: GNSS_SENSITIVE keeps 5 mm away (custom rule)
        self.cells_cache = {}

    # ------------------------------------------------------------------ painting
    @staticmethod
    def cells_in(poly, clip=None):
        if poly.OutlineCount() == 0:
            return
        box = poly.BBox()
        i0, j0 = cell_of(box.GetLeft(), box.GetTop())
        i1, j1 = cell_of(box.GetRight(), box.GetBottom())
        if clip:
            i0, j0, i1, j1 = max(i0, clip[0]), max(j0, clip[1]), min(i1, clip[2]), min(j1, clip[3])
        for j in range(max(0, j0 - 1), min(NY, j1 + 2)):
            for i in range(max(0, i0 - 1), min(NX, i1 + 2)):
                if poly.Contains(nm_of(i, j)):
                    yield j * NX + i

    @staticmethod
    def mark(grid, k: int, value: int) -> None:
        old = grid[k]
        if old == 0:
            grid[k] = value
        elif old != value:
            grid[k] = -1

    def paint(self, grid, poly, value: int, clip=None) -> None:
        for k in self.cells_in(poly, clip):
            self.mark(grid, k, value)

    @staticmethod
    def item_poly(item, layer, inflate: float):
        poly = pcbnew.SHAPE_POLY_SET()
        item.TransformShapeToPolygon(poly, layer, mm(inflate), mm(0.005), pcbnew.ERROR_OUTSIDE)
        return poly

    def clearance_of(self, item, layer) -> float:
        own = pcbnew.ToMM(item.GetOwnClearance(layer)) if item.GetNetCode() else 0.15
        return max(0.15, own)

    def add_item(self, item, net: int, clearance: float, clip=None) -> None:
        """An item of copper (any net) as an obstacle for the other nets."""
        value = net if net > 0 else -1
        rf = item.GetNetClassName() == "RF_50" and self.courtyard_lna is not None
        for li, layer in enumerate(self.layers):
            if not item.IsOnLayer(layer):
                continue
            for grid, r in ((self.t[li], H0), (self.v[li], VIA[0] / 2)):
                if rf:  # 0.5 mm outside the LNA's courtyard, 0.15 mm inside (rule "RF_50: alrededor del LNA")
                    self.paint(grid, self.item_poly(item, layer, 0.15 + r + MARGIN), value, clip)
                    poly = self.item_poly(item, layer, 0.5 + r + MARGIN)
                    poly.BooleanSubtract(self.courtyard_lna)
                    self.paint(grid, poly, value, clip)
                else:
                    self.paint(grid, self.item_poly(item, layer, clearance + r + MARGIN), value, clip)
        if item.Type() == pcbnew.PCB_PAD_T:  # never a via in a pad, of any net
            for li, layer in enumerate(self.layers):
                if item.IsOnLayer(layer):
                    self.paint(self.v[li], self.item_poly(item, layer, VIA[0] / 2 + 0.02), -1, clip)
                    for k in self.cells_in(self.item_poly(item, layer, HALO), clip):
                        self.halo[li][k] = 1
        if item.Type() == pcbnew.PCB_VIA_T or (item.Type() == pcbnew.PCB_PAD_T and item.HasHole()):
            ci, cj = cell_of(item.GetPosition().x, item.GetPosition().y)
            for di, dj in VIA_DISK:
                ii, jj = ci + di, cj + dj
                if 0 <= ii < NX and 0 <= jj < NY and (not clip or (clip[0] <= ii <= clip[2] and clip[1] <= jj <= clip[3])):
                    self.vs[jj * NX + ii] = 1

    def load(self) -> None:
        board = self.board
        items = [p for fp in board.GetFootprints() for p in fp.Pads()] + list(board.GetTracks())
        for item in items:
            if item.GetNetClassName() == "SW_NODE":
                self.sw.append(item.GetBoundingBox())
            if item.Type() == pcbnew.PCB_PAD_T and not any(item.IsOnLayer(l) for l in self.layers) \
                    and not item.HasHole():
                continue
            layer = next((l for l in self.layers if item.IsOnLayer(l)), pcbnew.F_Cu)
            self.add_item(item, item.GetNetCode(), self.clearance_of(item, layer))
        self.keepouts()
        self.tb = [array("i", a) for a in self.t]
        self.vb = [array("i", a) for a in self.v]
        self.vsb = array("b", self.vs)

    def block_rect(self, grids, x0, y0, x1, y1, grow: float) -> None:
        i0, j0 = int(math.floor((x0 - grow) / G)), int(math.floor((y0 - grow) / G))
        i1, j1 = int(math.ceil((x1 + grow) / G)), int(math.ceil((y1 + grow) / G))
        for grid in grids:
            for j in range(max(0, j0), min(NY, j1 + 1)):
                for i in range(max(0, i0), min(NX, i1 + 1)):
                    grid[j * NX + i] = -1

    @staticmethod
    def inflated(poly, r: float):
        out = pcbnew.SHAPE_POLY_SET(poly)
        out.Inflate(mm(r), pcbnew.CORNER_STRATEGY_ROUND_ALL_CORNERS, mm(0.005))
        return out

    def keepouts(self) -> None:
        board = self.board
        t, v = self.t, self.v
        for z in list(board.Zones()) + [z for fp in board.GetFootprints() for z in fp.Zones()]:
            if not z.GetIsRuleArea():
                continue
            name = z.GetZoneName()
            poly = z.Outline()
            for li, layer in enumerate(self.layers):
                if not z.IsOnLayer(layer):
                    continue
                if name in ("BLE_ANTENA", "LORA_ANTENA") or (z.GetDoNotAllowTracks() and not name) \
                        or (name == "GNSS_ANTENA" and layer == pcbnew.F_Cu) \
                        or (name == "L3_GND" and layer == pcbnew.In2_Cu):
                    self.paint(t[li], self.inflated(poly, H0 + MARGIN), -1)
            # vias cross every layer: a keep-out of vias on any layer forbids them
            if name in ("BLE_ANTENA", "LORA_ANTENA", "GNSS_ANTENA") or z.GetDoNotAllowVias():
                for g in v:
                    self.paint(g, self.inflated(poly, VIA[0] / 2 + MARGIN), -1)
        self.block_rect([t[1], t[2]], 8.6, 60.7, 14.4, 62.9, H0 + MARGIN)  # nothing under the crystal on L3/L4
        outline = pcbnew.SHAPE_POLY_SET()
        board.GetBoardPolygonOutlines(outline, False)
        edges = [d.GetEffectiveShape() for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
        rt, rv = mm(0.3 + H0 + MARGIN), mm(0.3 + VIA[0] / 2 + MARGIN)
        for j in range(NY):
            y = j * G
            for i in range(NX):
                x = i * G
                if not (x < 3.5 or x > 46.5 or y < 3.5 or y > 66.5):
                    continue
                p = nm_of(i, j)
                k = j * NX + i
                if not outline.Contains(p):
                    for g in t + v:
                        g[k] = -1
                    continue
                if any(e.Collide(p, rv) for e in edges):
                    for g in v:
                        g[k] = -1
                    if any(e.Collide(p, rt) for e in edges):
                        for g in t:
                            g[k] = -1

    def rebuild(self, box: tuple, routed: dict) -> None:
        """Back to the fixed obstacles inside ``box`` (cells) and repaint the routed items that touch it."""
        i0, j0, i1, j1 = box
        i0, j0, i1, j1 = max(0, i0), max(0, j0), min(NX - 1, i1), min(NY - 1, j1)
        for j in range(j0, j1 + 1):
            a, b = j * NX + i0, j * NX + i1 + 1
            for li in range(3):
                self.t[li][a:b] = self.tb[li][a:b]
                self.v[li][a:b] = self.vb[li][a:b]
            self.vs[a:b] = self.vsb[a:b]
        clip = (i0, j0, i1, j1)
        reach = mm(1.2)
        for net, items in routed.items():
            for item in items:
                bb = item.GetBoundingBox()
                bi0, bj0 = cell_of(bb.GetLeft() - reach, bb.GetTop() - reach)
                bi1, bj1 = cell_of(bb.GetRight() + reach, bb.GetBottom() + reach)
                if bi1 < i0 or bi0 > i1 or bj1 < j0 or bj0 > j1:
                    continue
                self.add_item(item, net, max(0.15, self.clearance_of(item, item.GetLayer())), clip)

    def own_cells(self, item, net: int) -> list:
        key = item.m_Uuid.AsString()
        if key in self.cells_cache:
            return self.cells_cache[key]
        out = []
        for li, layer in enumerate(self.layers):
            if not item.IsOnLayer(layer):
                continue
            poly = pcbnew.SHAPE_POLY_SET()
            item.TransformShapeToPolygon(poly, layer, mm(-0.02), mm(0.005), pcbnew.ERROR_INSIDE)
            out += [(li, k % NX, k // NX) for k in self.cells_in(poly)]
        self.cells_cache[key] = out
        return out

    # ------------------------------------------------------------------ routing
    def route(self, net: int, cls: str, sources: list, targets: dict, layers_ok: list[int], width: float,
              soft: bool = False):
        """A* from the source cells to the target cells. Returns the path [(layer, i, j), ...] or None. With
        ``soft`` the copper of the routed nets can be crossed at a cost (only the fixed copper blocks)."""
        extra = (width / 2 - H0) + EXTRA_CLEARANCE.get(cls, 0.0)
        dsk = disk(extra) if extra > 1e-6 else [(0, 0)]
        sw = [(pcbnew.ToMM(b.GetLeft()) - ORIGIN[0] - 5.2, pcbnew.ToMM(b.GetTop()) - ORIGIN[1] - 5.2,
               pcbnew.ToMM(b.GetRight()) - ORIGIN[0] + 5.2, pcbnew.ToMM(b.GetBottom()) - ORIGIN[1] + 5.2)
              for b in self.sw] if cls == "GNSS_SENSITIVE" else []
        t, tb, v, vb, vs, vsb = self.t, self.tb, self.v, self.vb, self.vs, self.vsb
        okc = {}

        def free_in(grid, i, j):
            for di, dj in dsk:
                ii, jj = i + di, j + dj
                if not (0 <= ii < NX and 0 <= jj < NY):
                    return False
                val = grid[jj * NX + ii]
                if val != 0 and val != net:
                    return False
            return True

        def ok(li, i, j):
            key = (li, i, j)
            r = okc.get(key, -2)
            if r != -2:
                return r
            if sw and any(a <= i * G <= c and b <= j * G <= d for a, b, c, d in sw):
                r = None
            elif free_in(t[li], i, j):
                r = 0
            elif soft and free_in(tb[li], i, j):
                r = 1
            else:
                r = None
            okc[key] = r
            return r

        def via_ok(i, j):
            k = j * NX + i
            cross = 0
            if vs[k]:
                if not soft or vsb[k]:
                    return None
                cross = 1
            for li in range(3):
                val = v[li][k]
                if val != 0 and val != net:
                    if not soft:
                        return None
                    base = vb[li][k]
                    if base != 0 and base != net:
                        return None
                    cross = 1
            for li in layers_ok:
                r = ok(li, i, j)
                if r is None:
                    return None
                cross = max(cross, r)
            return cross

        tx = [c[1] for c in targets]
        ty = [c[2] for c in targets]
        bx0, bx1, by0, by1 = min(tx), max(tx), min(ty), max(ty)

        def h(i, j):
            dx = max(bx0 - i, 0, i - bx1)
            dy = max(by0 - j, 0, j - by1)
            return 1.2 * (max(dx, dy) + 0.4142 * min(dx, dy))

        openq, g, came = [], {}, {}
        for s in sources:
            if s[0] in layers_ok and ok(*s) is not None:
                g[s] = 0.0
                heapq.heappush(openq, (h(s[1], s[2]), 0.0, s))
        n = 0
        limit = EXPAND * (2 if soft else 1)
        while openq:
            f, gc, node = heapq.heappop(openq)
            if gc > g.get(node, 1e18):
                continue
            if node in targets:
                path = [node]
                while path[-1] in came:
                    path.append(came[path[-1]])
                return path[::-1]
            n += 1
            if n > limit:
                return None
            li, i, j = node
            lc = LAYER_COST[li]
            halo = self.halo[li]
            for di, dj, c in STEPS:
                ni, nj = i + di, j + dj
                if not (0 <= ni < NX and 0 <= nj < NY):
                    continue
                nb = (li, ni, nj)
                r = ok(*nb)
                if r is None:
                    continue
                ng = gc + c * lc + r * RIP_COST
                if halo[nj * NX + ni] and nb not in targets:
                    ng += HALO_COST
                if ng < g.get(nb, 1e18):
                    g[nb] = ng
                    came[nb] = node
                    heapq.heappush(openq, (ng + h(ni, nj), ng, nb))
            r = via_ok(i, j)
            if r is not None:
                for lj in layers_ok:
                    if lj == li:
                        continue
                    nb = (lj, i, j)
                    ng = gc + VIA_COST + r * RIP_COST * 4
                    if ng < g.get(nb, 1e18):
                        g[nb] = ng
                        came[nb] = node
                        heapq.heappush(openq, (ng + h(i, j), ng, nb))
        return None


def components(board, net: int) -> list[list]:
    items = [p for fp in board.GetFootprints() for p in fp.Pads() if p.GetNetCode() == net]
    items += [t for t in board.GetTracks() if t.GetNetCode() == net]
    parent = list(range(len(items)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    layers = [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]
    boxes = [it.GetBoundingBox() for it in items]
    for a in range(len(items)):
        for b in range(a + 1, len(items)):
            if find(a) == find(b) or not boxes[a].Intersects(boxes[b]):
                continue
            ia, ib = items[a], items[b]
            for layer in layers:
                if ia.IsOnLayer(layer) and ib.IsOnLayer(layer) and \
                        ia.GetEffectiveShape(layer).Collide(ib.GetEffectiveShape(layer), 0):
                    parent[find(a)] = find(b)
                    break
    groups = {}
    for k, it in enumerate(items):
        groups.setdefault(find(k), []).append(it)
    return list(groups.values())


def simplify(points: list) -> list:
    out = [points[0]]
    for p in points[1:]:
        if len(out) >= 2:
            (x0, y0), (x1, y1) = out[-2], out[-1]
            if (x1 - x0) * (p[1] - y1) == (y1 - y0) * (p[0] - x1) and (x1 - x0) * (p[0] - x1) >= 0 \
                    and (y1 - y0) * (p[1] - y1) >= 0:
                out[-1] = p
                continue
        out.append(p)
    return out


def emit(board, grid: Grid, netinfo, path: list, width: float) -> list:
    items = []
    run = [path[0]]
    for node in path[1:] + [None]:
        if node is not None and node[0] == run[-1][0]:
            run.append(node)
            continue
        pts = simplify([(c[1], c[2]) for c in run])
        layer = grid.layers[run[0][0]]
        for (i0, j0), (i1, j1) in zip(pts, pts[1:]):
            tr = pcbnew.PCB_TRACK(board)
            tr.SetStart(nm_of(i0, j0))
            tr.SetEnd(nm_of(i1, j1))
            tr.SetWidth(mm(width))
            tr.SetLayer(layer)
            tr.SetNet(netinfo)
            board.Add(tr)
            items.append(tr)
        if node is not None:  # layer change: a via at this cell
            via = pcbnew.PCB_VIA(board)
            via.SetPosition(nm_of(node[1], node[2]))
            via.SetWidth(mm(VIA[0]))
            via.SetDrill(mm(VIA[1]))
            via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            via.SetNet(netinfo)
            board.Add(via)
            items.append(via)
            run = [node]
    return items


def crossed(grid: Grid, path: list, routed: dict, net: int, width: float) -> set:
    """The routed nets whose copper (with clearance) the path of a soft search runs into."""
    hit = set()
    r = mm(width / 2 + 0.3 + MARGIN)
    pts = [(nm_of(i, j), li) for li, i, j in path]
    for other, items in routed.items():
        if other == net:
            continue
        for item in items:
            box = item.GetBoundingBox()
            box.Inflate(mm(1.0))
            via = item.Type() == pcbnew.PCB_VIA_T
            for p, li in pts:
                if not box.Contains(p):
                    continue
                layer = grid.layers[li]
                if (via or item.IsOnLayer(layer)) and \
                        item.GetEffectiveShape(layer).Collide(pcbnew.SHAPE_CIRCLE(p, r + (mm(0.3) if via else 0)), 0):
                    hit.add(other)
                    break
            if other in hit:
                break
    return hit


def bbox_cells(items: list, grow: float = 1.5) -> tuple:
    box = items[0].GetBoundingBox()
    for it in items[1:]:
        box.Merge(it.GetBoundingBox())
    i0, j0 = cell_of(box.GetLeft() - mm(grow), box.GetTop() - mm(grow))
    i1, j1 = cell_of(box.GetRight() + mm(grow), box.GetBottom() + mm(grow))
    return i0, j0, i1, j1


def route_all(board, log=print):
    """Routes every net but GND (and the classes of `criticas`). Returns (connections routed, nets left)."""
    grid = Grid(board)
    grid.load()
    nets = {n.GetNetCode(): n for n in board.GetNetsByNetcode().values()}
    queue = []
    for code, n in nets.items():
        name = n.GetNetname()
        if code <= 0 or code == grid.gnd or name.startswith("unconnected"):
            continue
        if n.GetNetClassName() in SKIP_CLASSES:
            continue
        comps = components(board, code)
        if len(comps) > 1:
            box = comps[0][0].GetBoundingBox()
            for c in comps:
                for it in c:
                    box.Merge(it.GetBoundingBox())
            queue.append((box.GetWidth() + box.GetHeight(), code))
    queue = [code for _, code in sorted(queue)]
    routed, rips, failed = {}, {}, set()
    done = steps = 0
    while queue and steps < 3000:
        steps += 1
        code = queue.pop(0)
        n = nets[code]
        cls = n.GetNetClassName()
        width = WIDTH.get(cls, 0.15)
        layers_ok = [0, 2] if cls == "POWER_DOCK" else [0, 1, 2]
        while True:
            comps = components(board, code)
            if len(comps) < 2:
                failed.discard(code)
                break
            comps.sort(key=len)
            sources = [c for it in comps[0] for c in grid.own_cells(it, code)]
            targets = {c: k for k, comp in enumerate(comps[1:]) for it in comp for c in grid.own_cells(it, code)}
            if not sources or not targets:
                failed.add(code)
                break
            path = grid.route(code, cls, sources, targets, layers_ok, width)
            if not path:
                path = grid.route(code, cls, sources, targets, layers_ok, width, soft=True)
                victims = crossed(grid, path, routed, code, width) if path else set()
                if path and (not victims or any(rips.get(v, 0) >= MAX_RIPS for v in victims)):
                    path = None
                if path:
                    removed = []
                    for vnet in victims:
                        removed += routed.pop(vnet, [])
                        rips[vnet] = rips.get(vnet, 0) + 1
                        queue.append(vnet)
                    box = bbox_cells(removed)
                    for item in removed:
                        board.Remove(item)
                    grid.rebuild(box, routed)
                    log(f"{n.GetNetname()}: levanto {sorted(nets[v].GetNetname() for v in victims)}")
            if not path:
                failed.add(code)
                log(f"sin ruta: {n.GetNetname()}")
                break
            items = emit(board, grid, n, path, width)
            routed.setdefault(code, []).extend(items)
            for item in items:
                grid.add_item(item, code, max(0.15, grid.clearance_of(item, item.GetLayer())))
            done += 1
    left = sorted({nets[c].GetNetname() for c in failed | set(queue)})
    return done, left
