"""Grid maze router for the nets that ``rutear.py criticas`` leaves (B-909). Used by ``rutear.py resto``.

Freerouting (2.5.0) did not finish this board: with the 0.5 mm of RF_50, the keep-outs of the antennas and the via
field of the BMD-340 it stalled at 150-190 unrouted connections after 40 passes. This router does the rest with the
board's own rules, all of them known here (it is not a general autorouter):

- a 0.05 mm grid on L1, L3, L4 and L6 of the 6-layer board (L2 and L5 are the GND planes: only vias cross them), A*
  with 45-degree moves, a cost per via, L3 preferred over L4, L4 over L6 and L6 over L1 (L1 keeps room for the pads),
  no track on L4 over the VREG island (`rutear.py isla`), and a cost next to the pads of other nets;
- every copper item of another net blocks the cells closer than its clearance (its net class or pad, at least the
  0.15 mm of Default; RF_50 0.5 mm, and 0.15 mm inside the LNA's courtyard as the custom rule says) plus half the track
  and a margin for the grid; the routed net adds its own (GNSS_SENSITIVE 0.3 mm, POWER_DOCK 0.2 mm) and its width;
- the rule areas: nothing in BLE_ANTENA and LORA_ANTENA, no track on L1 and no via in GNSS_ANTENA, the footprint
  keep-outs (the patch pin), nothing on L3, L4 or L6 under the 32.768 kHz crystal, nothing of GNSS_SENSITIVE within
  5 mm of the switch node, POWER_DOCK only on L1 and L6, 0.3 mm of copper to the edge;
- vias of 0.5/0.2 mm, never in a pad, at least 0.5 mm between via centres;
- GND is not routed (planes and `rutear.py planos`); VREG joins its pads outside the island of L4 to the nearest VREG
  copper (the island joins every via on it).

Each net is routed as a growing tree: the smallest group of connected copper to the nearest other one, until the net
is one group. When a connection has no free path, it is searched again allowing to cross what this router already
routed (at a cost): the nets in the way are ripped up and go back to the queue (rip-up and reroute, at most
``MAX_RIPS`` times per net). Deterministic: same board, same result.
"""

from __future__ import annotations

import gc
import heapq
import math
from array import array

import pcbnew

ORIGIN = (100.0, 100.0)
G = 0.05  # mm per cell
NX, NY = 1000, 1400  # 50 x 70 mm
MARGIN = 0.037  # grid error: a 45-degree step passes 0.0354 mm from the cell centres
H0 = 0.075  # half the narrowest track (0.15 mm)
VIA = (0.5, 0.2)
VIA_PITCH = 0.5  # mm between via centres (hole to hole 0.3 mm)
VIA_COST = 24  # cells (1.2 mm)
LAYER_COST = (1.4, 1.0, 1.05, 1.15)  # L1, L3, L4, L6 (L3 and L4 are signal layers between the GND planes of L2 and L5)
PF_GROWTH = 1.4  # present-congestion factor per round (2.0 oscillated on 6 layers)
PF_MAX = 40.0  # without a cap the present cost swamps the history and the routes oscillate
HIST_STEP = 0.4  # history added per round around every shared cell (a disk, not the centre line only)
HIST_R = 0.25  # mm
HALO = 0.45  # mm around every pad
HALO_COST = 2.0
RIP_COST = 8.0  # per cell of routed copper crossed in a rip-up search
MAX_RIPS = 8
EXPAND = 800000

WIDTH = {"Default": 0.15, "GNSS_SENSITIVE": 0.15, "POWER": 0.25, "POWER_DOCK": 0.3}
EXTRA_CLEARANCE = {"GNSS_SENSITIVE": 0.15, "POWER_DOCK": 0.05}  # over the 0.15 mm of the grid
SKIP_CLASSES = {"RF_50", "USB_90D", "SW_NODE"}
PLANE_NETS = {"VREG"}  # VREG joins through its island of L4 when there is one (rutear.py isla); elsewhere, tracks
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
HIST_DISK = disk(HIST_R)


class Grid:
    def __init__(self, board):
        self.board = board
        self.layers = [pcbnew.F_Cu, pcbnew.In2_Cu, pcbnew.In3_Cu, pcbnew.B_Cu]
        n = NX * NY
        self.t = [array("i", bytes(4 * n)) for _ in self.layers]  # track centre: 0 free, net, -1 blocked
        self.v = [array("i", bytes(4 * n)) for _ in self.layers]  # via centre: same
        self.vs = array("i", bytes(4 * n))  # within VIA_PITCH of a via centre: its net (-1 several or none)
        self.halo = [array("b", bytes(n)) for _ in self.layers]
        self.gnd = board.FindNet("GND").GetNetCode()
        self.courtyard_lna = None
        self.bmd = None  # BMD-340 courtyard, in cells: GNSS_SENSITIVE at 0.15 mm inside it (custom rule)
        for fp in board.GetFootprints():
            if fp.GetReference() == "U205":
                self.courtyard_lna = fp.GetCourtyard(pcbnew.F_CrtYd)
            if fp.GetReference() == "U301":
                box = fp.GetCourtyard(pcbnew.F_CrtYd).BBox()
                self.bmd = cell_of(box.GetLeft(), box.GetTop()) + cell_of(box.GetRight(), box.GetBottom())
                self.bmd_box = box
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
        if item.GetNetCode():
            own = pcbnew.ToMM(item.GetOwnClearance(layer))
        elif item.Type() == pcbnew.PCB_PAD_T:  # no net: the fiducials' 0.6 mm (it also clears their mask opening) and
            local = item.GetLocalClearance()  # the 0.25 mm of hole clearance around a hole without copper (NPTH)
            own = pcbnew.ToMM(local) if local else 0.15
            if item.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
                own = max(own, 0.25)
        else:
            own = 0.15
        return max(0.15, own)

    def add_item(self, item, net: int, clearance: float, clip=None) -> None:
        """An item of copper (any net) as an obstacle for the other nets."""
        value = net if net > 0 else -1
        if item.GetNetClassName() == "GNSS_SENSITIVE" and self.bmd and item.GetBoundingBox().Intersects(self.bmd_box):
            clearance = 0.15  # rule "GNSS_SENSITIVE: escape del BMD-340"
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
                    self.mark(self.vs, jj * NX + ii, net if net > 0 else -1)

    def load(self) -> None:
        board = self.board
        items = [p for fp in board.GetFootprints() for p in fp.Pads()] + list(board.GetTracks())
        self.swmask = array("b", bytes(NX * NY))  # within 5 mm of the switch node: no GNSS_SENSITIVE (custom rule)
        for item in items:
            if item.GetNetClassName() == "SW_NODE":
                layer = next(l for l in self.layers if item.IsOnLayer(l))
                for k in self.cells_in(self.item_poly(item, layer, 5.0 + H0 + MARGIN)):
                    self.swmask[k] = 1
            if item.Type() == pcbnew.PCB_PAD_T and not any(item.IsOnLayer(l) for l in self.layers) \
                    and not item.HasHole():
                continue
            layer = next((l for l in self.layers if item.IsOnLayer(l)), pcbnew.F_Cu)
            self.add_item(item, item.GetNetCode(), self.clearance_of(item, layer))
        self.keepouts()
        self.tb = [array("i", a) for a in self.t]
        self.vb = [array("i", a) for a in self.v]
        self.vsb = array("i", self.vs)

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
                # the VREG island of L4 (``rutear.py isla``) takes L4 there: no track on it, vias cross it
                if z.GetNetname() in PLANE_NETS and z.IsOnLayer(pcbnew.In3_Cu) and pcbnew.In3_Cu in self.layers:
                    li = self.layers.index(pcbnew.In3_Cu)
                    self.paint(t[li], self.inflated(z.Outline(), H0 + MARGIN), -1)
                continue
            name = z.GetZoneName()
            poly = z.Outline()
            for li, layer in enumerate(self.layers):
                if not z.IsOnLayer(layer):
                    continue
                if name in ("BLE_ANTENA", "LORA_ANTENA") or (z.GetDoNotAllowTracks() and not name) \
                        or (name == "GNSS_ANTENA" and layer == pcbnew.F_Cu):
                    self.paint(t[li], self.inflated(poly, H0 + MARGIN), -1)
            # vias cross every layer: a keep-out of vias on any layer forbids them
            if name in ("BLE_ANTENA", "LORA_ANTENA", "GNSS_ANTENA") or z.GetDoNotAllowVias():
                for g in v:
                    self.paint(g, self.inflated(poly, VIA[0] / 2 + MARGIN), -1)
        self.block_rect(t[1:], 8.6, 60.7, 14.4, 62.9, H0 + MARGIN)  # nothing under the crystal on L3, L4 and L6
        self.block_rect(v, 8.6, 60.7, 14.4, 62.9, VIA[0] / 2 + MARGIN)  # and no via of another net
        outline = pcbnew.SHAPE_POLY_SET()
        board.GetBoardPolygonOutlines(outline, False)
        edges = [d.GetEffectiveShape() for d in board.GetDrawings() if d.GetLayer() == pcbnew.Edge_Cuts]
        rt, rv = mm(0.3 + H0 + MARGIN), mm(0.3 + VIA[0] / 2 + MARGIN)
        for j in range(NY):
            y = j * G
            for i in range(NX):
                x = i * G
                if not (x < 3.5 or x > 46.5 or y < 3.5 or y > 66.5 or ((x < 6 or x > 44) and (y < 6 or y > 64))):  # notches
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
            for li in range(len(self.layers)):
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
        sw = self.swmask if cls == "GNSS_SENSITIVE" else None
        t, tb, v, vb, vs, vsb = self.t, self.tb, self.v, self.vb, self.vs, self.vsb
        if soft:  # only the fixed copper: the routed nets the path runs into are ripped up afterwards
            t, v, vs = tb, vb, vsb
        okc = {}

        bmd = self.bmd if cls == "GNSS_SENSITIVE" else None

        def free_in(grid, i, j):
            d = dsk
            if bmd and bmd[0] <= i <= bmd[2] and bmd[1] <= j <= bmd[3]:
                d = ((0, 0),)  # inside the BMD-340's courtyard: 0.15 mm, as the grid
            for di, dj in d:
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
            if sw and sw[j * NX + i]:
                r = None
            elif free_in(t[li], i, j):
                r = 0
            else:
                r = None
            okc[key] = r
            return r

        def via_ok(i, j):
            k = j * NX + i
            cross = 0
            if vs[k]:  # hole to hole: also against the vias of the same net
                if not soft or vsb[k] or vs[k] == net:
                    return None
                cross = 1
            for li in range(len(self.layers)):
                val = v[li][k]
                if val != 0 and val != net:
                    if not soft:
                        return None
                    base = vb[li][k]
                    if base != 0 and base != net:
                        return None
                    cross = 1
            # the via grid already has every obstacle and keep-out of vias; the track grid does not count here (L3_GND
            # forbids tracks on L3, not vias)
            if sw and sw[k]:
                return None
            return cross

        tx = [c[1] for c in targets]
        ty = [c[2] for c in targets]
        bx0, bx1, by0, by1 = min(tx), max(tx), min(ty), max(ty)

        def h(i, j):
            dx = max(bx0 - i, 0, i - bx1)
            dy = max(by0 - j, 0, j - by1)
            return 2.2 * (max(dx, dy) + 0.4142 * min(dx, dy))

        self.expanded = 0
        openq, g, came = [], {}, {}
        for s in sources:
            if s[0] in layers_ok and ok(*s) is not None:
                g[s] = 0.0
                heapq.heappush(openq, (h(s[1], s[2]), 0.0, s))
        n = 0
        limit = EXPAND * (4 if soft else 1)
        closed = set()
        while openq:
            f, gc, node = heapq.heappop(openq)
            if gc > g.get(node, 1e18) or node in closed:
                continue
            closed.add(node)  # weighted A* without reopening
            if node in targets:
                path = [node]
                while path[-1] in came:
                    path.append(came[path[-1]])
                return straighten(path[::-1], lambda li, i, j: ok(li, i, j) == 0)
            n += 1
            self.expanded = n
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


    # ------------------------------------------------------------------ negotiated congestion (PathFinder)
    def add_hist(self, li: int, i: int, j: int) -> None:
        for di, dj in HIST_DISK:
            ii, jj = i + di, j + dj
            if 0 <= ii < NX and 0 <= jj < NY:
                self.hist[li][jj * NX + ii] += HIST_STEP

    def init_pf(self) -> None:
        n = NX * NY
        self.ot = [array("h", bytes(2 * n)) for _ in self.layers]  # routed nets whose track keep-away covers the cell
        self.ov = [array("h", bytes(2 * n)) for _ in self.layers]  # same for vias
        self.ovs = array("h", bytes(2 * n))  # within VIA_PITCH of a routed via
        self.hist = [array("f", bytes(4 * n)) for _ in self.layers]  # history of congestion
        # cells where a track centre lies in the fixed copper of its net with all its width: nothing new there
        self.inside = [array("i", bytes(4 * n)) for _ in self.layers]
        items = [p for fp in self.board.GetFootprints() for p in fp.Pads()] + list(self.board.GetTracks())
        for item in items:
            code = item.GetNetCode()
            if code <= 0:
                continue
            for li, layer in enumerate(self.layers):
                if item.IsOnLayer(layer):
                    poly = pcbnew.SHAPE_POLY_SET()
                    item.TransformShapeToPolygon(poly, layer, mm(-H0), mm(0.005), pcbnew.ERROR_INSIDE)
                    for k in self.cells_in(poly):
                        self.inside[li][k] = code

    def cover(self, item) -> list:
        """The cells a routed item keeps the other nets away from: [(kind, layer index, cell)]."""
        out = []
        clearance = max(0.15, self.clearance_of(item, item.GetLayer()))
        if item.GetNetClassName() == "GNSS_SENSITIVE" and self.bmd and item.GetBoundingBox().Intersects(self.bmd_box):
            clearance = 0.15
        for li, layer in enumerate(self.layers):
            if not item.IsOnLayer(layer):
                continue
            out += [(0, li, k) for k in self.cells_in(self.item_poly(item, layer, clearance + H0 + MARGIN))]
            out += [(1, li, k) for k in self.cells_in(self.item_poly(item, layer, clearance + VIA[0] / 2 + MARGIN))]
        if item.Type() == pcbnew.PCB_VIA_T:
            ci, cj = cell_of(item.GetPosition().x, item.GetPosition().y)
            out += [(2, 0, (cj + dj) * NX + ci + di) for di, dj in VIA_DISK
                    if 0 <= ci + di < NX and 0 <= cj + dj < NY]
        return out

    def apply(self, cells: list, sign: int) -> None:
        for kind, li, k in cells:
            if kind == 0:
                self.ot[li][k] += sign
            elif kind == 1:
                self.ov[li][k] += sign
            else:
                self.ovs[k] += sign

    def route_pf(self, net: int, cls: str, sources: list, targets: dict, layers_ok: list, width: float, pf: float,
                 hard: bool = False):
        """A* over the fixed obstacles only; the copper of the other routed nets costs (present congestion times
        ``pf`` plus history) instead of blocking. Returns the path or None."""
        extra = (width / 2 - H0) + EXTRA_CLEARANCE.get(cls, 0.0)
        dsk = disk(extra) if extra > 1e-6 else [(0, 0)]
        sw = self.swmask if cls == "GNSS_SENSITIVE" else None
        tb, vb, vsb, ot, ov, ovs, hist = self.tb, self.vb, self.vsb, self.ot, self.ov, self.ovs, self.hist
        bmd = self.bmd if cls == "GNSS_SENSITIVE" else None
        okc = {}

        def ok(li, i, j):
            """Cost factor of a track centre here, or None if the fixed copper forbids it."""
            key = (li, i, j)
            r = okc.get(key, -2)
            if r != -2:
                return r
            r = None
            if not (sw and sw[j * NX + i]):
                d = ((0, 0),) if bmd and bmd[0] <= i <= bmd[2] and bmd[1] <= j <= bmd[3] else dsk
                occ = 0
                grid, cong, inside = tb[li], ot[li], self.inside[li]
                for di, dj in d:
                    ii, jj = i + di, j + dj
                    if not (0 <= ii < NX and 0 <= jj < NY):
                        break
                    k = jj * NX + ii
                    val = grid[k]
                    if val != 0 and val != net:
                        break
                    if cong[k] > occ and inside[k] != net:  # a centre deep in its own copper adds no copper
                        occ = cong[k]
                else:
                    k = j * NX + i
                    r = None if hard and occ else (1.0 + hist[li][k]) * (1.0 + pf * occ)
            okc[key] = r
            return r

        # a via keeps the class's own extra clearance too (GNSS_SENSITIVE 0.3 mm, POWER_DOCK 0.2 mm), like a track
        vextra = EXTRA_CLEARANCE.get(cls, 0.0)
        vdsk = disk(vextra) if vextra > 1e-6 else [(0, 0)]

        def via_ok(i, j):
            k = j * NX + i
            if vsb[k] or (sw and sw[k]):
                return None
            occ = ovs[k]
            d = ((0, 0),) if bmd and bmd[0] <= i <= bmd[2] and bmd[1] <= j <= bmd[3] else vdsk
            for li in range(len(self.layers)):
                most = 0
                for di, dj in d:
                    ii, jj = i + di, j + dj
                    if not (0 <= ii < NX and 0 <= jj < NY):
                        return None
                    kk = jj * NX + ii
                    val = vb[li][kk]
                    if val != 0 and val != net:
                        return None
                    most = max(most, ov[li][kk])
                occ += most
            return None if hard and occ else (1.0 + hist[0][k]) * (1.0 + pf * occ)

        tx = [c[1] for c in targets]
        ty = [c[2] for c in targets]
        bx0, bx1, by0, by1 = min(tx), max(tx), min(ty), max(ty)

        def h(i, j):
            dx = max(bx0 - i, 0, i - bx1)
            dy = max(by0 - j, 0, j - by1)
            return 2.2 * (max(dx, dy) + 0.4142 * min(dx, dy))

        openq, g, came = [], {}, {}
        for s0 in sources:
            if s0[0] in layers_ok and ok(*s0) is not None:
                g[s0] = 0.0
                heapq.heappush(openq, (h(s0[1], s0[2]), 0.0, s0))
        n = 0
        closed = set()
        while openq:
            f, gc, node = heapq.heappop(openq)
            if node in closed:
                continue
            closed.add(node)
            if node in targets:
                path = [node]
                while path[-1] in came:
                    path.append(came[path[-1]])
                # straighten only over cells shared with nobody
                return straighten(path[::-1],
                                  lambda li, i, j: (ok(li, i, j) or 1e9) <= 1.0 + hist[li][j * NX + i] + 1e-9)
            n += 1
            if n > EXPAND * 3:
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
                ng = gc + c * lc * r
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
                    ng = gc + VIA_COST * r
                    if ng < g.get(nb, 1e18):
                        g[nb] = ng
                        came[nb] = node
                        heapq.heappush(openq, (ng + h(i, j), ng, nb))
        return None


def straighten(path: list, free) -> list:
    """Fewer, longer segments: on each layer run, jump to the farthest later cell that a straight line (any angle)
    reaches over free cells only (the grid margin covers a line between cell centres)."""
    out = [path[0]]
    k = 0
    while k < len(path) - 1:
        li = path[k][0]
        best = k + 1
        end = k + 1
        while end < len(path) and path[end][0] == li:
            end += 1
        for m in range(end - 1, k + 1, -1):
            (_, i0, j0), (_, i1, j1) = path[k], path[m]
            n = max(abs(i1 - i0), abs(j1 - j0)) * 2
            if all(free(li, round(i0 + (i1 - i0) * t / n), round(j0 + (j1 - j0) * t / n)) for t in range(n + 1)):
                best = m
                break
        out.append(path[best])
        k = best
    return out


def components(board, net: int) -> list[list]:
    """The groups of connected copper of ``net``. For a net with a plane (``PLANE_NETS``), every group with a via
    is one: the plane of L4 joins them."""
    items = [p for fp in board.GetFootprints() for p in fp.Pads() if p.GetNetCode() == net]
    items += [t for t in board.GetTracks() if t.GetNetCode() == net]
    parent = list(range(len(items)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    layers = [pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.In3_Cu, pcbnew.In4_Cu, pcbnew.B_Cu]
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
    if board.GetNetInfo().GetNetItem(net).GetNetname() in PLANE_NETS:
        # The island of L4 (its zone filled by ``rutear.py isla``): the vias on the same piece of the fill are
        # joined. Without the island the net is tracks only.
        vias = [k for k, it in enumerate(items) if it.Type() == pcbnew.PCB_VIA_T]
        fills = [z.GetFilledPolysList(pcbnew.In3_Cu) for z in board.Zones()
                 if not z.GetIsRuleArea() and z.GetNetCode() == net and z.IsOnLayer(pcbnew.In3_Cu) and z.IsFilled()]
        piece = {}
        for k in vias if fills else []:
            where = next(((f, o) for f, polys in enumerate(fills) for o in range(polys.OutlineCount())
                          if polys.Outline(o).PointInside(items[k].GetPosition())), None)
            if where is None:
                continue
            if where in piece:
                parent[find(k)] = find(piece[where])
            else:
                piece[where] = k
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
    dense = [path[0]]
    for (l0, i0, j0), (l1, i1, j1) in zip(path, path[1:]):  # the straightened path: every cell along each segment
        n = max(abs(i1 - i0), abs(j1 - j0))
        if l0 == l1 and n > 1:
            dense += [(l0, round(i0 + (i1 - i0) * t / n), round(j0 + (j1 - j0) * t / n)) for t in range(1, n)]
        dense.append((l1, i1, j1))
    path = dense
    for li, i, j in path:  # cells owned by one routed net: its code is in the grid
        for di in (-2, -1, 0, 1, 2):
            for dj in (-2, -1, 0, 1, 2):
                ii, jj = i + di, j + dj
                if 0 <= ii < NX and 0 <= jj < NY:
                    k = jj * NX + ii
                    val = grid.t[li][k]
                    if val > 0 and val != net and val in routed and grid.tb[li][k] in (0, net):
                        hit.add(val)
    r = mm(width / 2 + 0.45 + MARGIN)
    pts = [(nm_of(i, j), li) for li, i, j in path]
    for other, items in routed.items():
        if other == net:
            continue
        if other in hit:
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


def dense_cells(items: list) -> list:
    """(layer index, i, j) along every routed track centre, and ("v", i, j) at every via."""
    out = []
    for it in items:
        if it.Type() == pcbnew.PCB_VIA_T:
            ci, cj = cell_of(it.GetPosition().x, it.GetPosition().y)
            out.append(("v", ci, cj))
            continue
        li = {pcbnew.F_Cu: 0, pcbnew.In2_Cu: 1, pcbnew.In3_Cu: 2, pcbnew.B_Cu: 3}[it.GetLayer()]
        i0, j0 = cell_of(it.GetStart().x, it.GetStart().y)
        i1, j1 = cell_of(it.GetEnd().x, it.GetEnd().y)
        n = max(abs(i1 - i0), abs(j1 - j0), 1)
        out += [(li, round(i0 + (i1 - i0) * t / n), round(j0 + (j1 - j0) * t / n)) for t in range(n + 1)]
    return out


def route_all(board, log=print, iterations: int = 8, only=None):
    """Negotiated congestion routing (PathFinder) of every net but GND and the classes of `criticas`: every round
    reroutes the nets whose copper still runs into another net's, with the cost of shared cells growing round after
    round, until nothing is shared. Returns (connections routed, nets left).

    The cyclic garbage collector is off while it runs: collecting the SWIG wrappers of pcbnew items mid-route crashed
    pcbnew at random (segfault, bus error) on 25/11/2026; the plain reference counting frees everything else."""
    gc.disable()
    try:
        return _route_all(board, log, iterations, only)
    finally:
        gc.enable()


def _route_all(board, log, iterations: int, only):
    grid = Grid(board)
    grid.load()
    grid.init_pf()
    nets = {n.GetNetCode(): n for n in board.GetNetsByNetcode().values()}
    todo = []
    for code, n in nets.items():
        name = n.GetNetname()
        if code <= 0 or code == grid.gnd or name.startswith("unconnected") or n.GetNetClassName() in SKIP_CLASSES:
            continue
        if only and name not in only:
            continue
        comps = components(board, code)
        if len(comps) > 1:
            box = comps[0][0].GetBoundingBox()
            for c in comps:
                for it in c:
                    box.Merge(it.GetBoundingBox())
            todo.append((box.GetWidth() + box.GetHeight(), code))
    redo = [code for _, code in sorted(todo)]
    order = list(redo)
    routed, covers, failed = {}, {}, set()
    done = 0
    pf = 1.0
    for rnd in range(iterations):
        for code in redo:
            n = nets[code]
            cls = n.GetNetClassName()
            width = WIDTH.get(cls, 0.15)
            layers_ok = [0, 3] if cls == "POWER_DOCK" else [0, 1, 2, 3]
            for item in routed.pop(code, []):
                board.Delete(item)
            grid.apply(covers.pop(code, []), -1)
            failed.discard(code)
            items, cells = [], []
            while True:
                comps = components(board, code)
                if len(comps) < 2:
                    break
                comps.sort(key=lambda comp: sum(len(grid.own_cells(it, code)) for it in comp))
                sources = [c for it in comps[0] for c in grid.own_cells(it, code)]
                targets = {c: k for k, comp in enumerate(comps[1:]) for it in comp for c in grid.own_cells(it, code)}
                path = grid.route_pf(code, cls, sources, targets, layers_ok, width, pf) if sources and targets else None
                if not path:
                    failed.add(code)
                    log(f"sin ruta: {n.GetNetname()} (lo fijo no deja)")
                    break
                items += emit(board, grid, n, path, width)
                done += 1
            for item in items:
                c = grid.cover(item)
                cells += c
                grid.apply(c, +1)
            routed[code] = items
            covers[code] = cells
        # who still shares cells with another net (its own coverage taken out); history grows there
        redo = []
        for code, items in routed.items():
            own = {}
            for key in covers[code]:
                own[key] = own.get(key, 0) + 1
            bad = False
            where = None
            for li, i, j in dense_cells(items):
                k = j * NX + i
                if li == "v":
                    occ = grid.ovs[k] - own.get((2, 0, k), 0)
                    occ += sum(grid.ov[x][k] - own.get((1, x, k), 0) for x in range(len(grid.layers)))
                    if occ > 0:
                        bad = True
                        where = where or ("vía", round(i * G, 2), round(j * G, 2))
                        for x in range(len(grid.layers)):
                            grid.add_hist(x, i, j)
                elif grid.inside[li][k] != code and grid.ot[li][k] - own.get((0, li, k), 0) > 0:
                    bad = True
                    where = where or (li, round(i * G, 2), round(j * G, 2))
                    grid.add_hist(li, i, j)
            if bad or code in failed:  # a net that found no way this round tries again in the next one
                redo.append(code)
                if rnd % 3 == 2:
                    log(f"  {nets[code].GetNetname()}: {where}")
        log(f"vuelta {rnd + 1}: {len(redo)} redes comparten cobre, {len(failed)} sin ruta, factor {pf:.1f}")
        if not redo and not failed:
            break
        pf = min(pf * PF_GROWTH, PF_MAX)
    # Whatever still shares copper goes away and gets one more try over free space only; each connection found joins
    # two pieces of its net, so a net left half way is still clean (the rest stays as ratsnest).
    for code in redo:
        for item in routed.pop(code, []):
            board.Delete(item)
        grid.apply(covers.pop(code, []), -1)
    left = set()
    for code in sorted(set(redo) | failed, key=order.index):
        n = nets[code]
        cls = n.GetNetClassName()
        width = WIDTH.get(cls, 0.15)
        layers_ok = [0, 3] if cls == "POWER_DOCK" else [0, 1, 2, 3]
        items = []
        while True:
            comps = components(board, code)
            if len(comps) < 2:
                break
            comps.sort(key=lambda comp: sum(len(grid.own_cells(it, code)) for it in comp))
            sources = [c for it in comps[0] for c in grid.own_cells(it, code)]
            targets = {c: k for k, comp in enumerate(comps[1:]) for it in comp for c in grid.own_cells(it, code)}
            path = grid.route_pf(code, cls, sources, targets, layers_ok, width, 1.0, hard=True)
            if not path:
                left.add(n.GetNetname())
                break
            new = emit(board, grid, n, path, width)
            for item in new:
                grid.apply(grid.cover(item), +1)
            items += new
        log(f"al final: {n.GetNetname()} {'completa' if n.GetNetname() not in left else 'queda a mano'}")
    return done, sorted(left)
