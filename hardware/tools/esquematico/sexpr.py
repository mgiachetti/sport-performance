"""Minimal S-expression reader and writer for KiCad files (standard library only)."""

from __future__ import annotations

import re
from typing import Union

_TOKEN = re.compile(r'\s*(?:(\()|(\))|"((?:[^"\\]|\\.)*)"|([^\s()"]+))')


class Str(str):
    """A string that was quoted in the source and is written back quoted."""


Node = Union[str, Str, list]


def parse(text: str) -> list:
    """Parse the first S-expression in ``text``."""
    pos = 0
    stack: list[list] = [[]]
    while True:
        match = _TOKEN.match(text, pos)
        if not match or match.end() == pos:
            break
        pos = match.end()
        if match.group(1):
            stack.append([])
        elif match.group(2):
            done = stack.pop()
            stack[-1].append(done)
        elif match.group(3) is not None:
            raw = match.group(3)
            stack[-1].append(Str(raw.replace('\\"', '"').replace("\\\\", "\\")))
        else:
            stack[-1].append(match.group(4))
    if len(stack) != 1 or not stack[0]:
        raise ValueError("unbalanced S-expression")
    return stack[0][0]


def quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


INLINE_MAX = 100


def inline(node: Node) -> str:
    if isinstance(node, Str):
        return quote(node)
    if isinstance(node, str):
        return node
    return "(" + " ".join(inline(c) for c in node) + ")"


def dump(node: Node, indent: int = 0) -> str:
    """Write a node with KiCad-like formatting: tabs, one child list per line unless it fits inline."""
    if isinstance(node, Str):
        return quote(node)
    if isinstance(node, str):
        return node
    if indent > 0:
        flat = inline(node)
        if len(flat) <= INLINE_MAX:
            return flat
    pad = "\t" * indent
    atoms = []
    children = []
    for child in node:
        if isinstance(child, list) and not children and _is_short(child):
            atoms.append(dump(child, 0))
        elif isinstance(child, list):
            children.append(child)
        elif children:
            # An atom after a child list: keep order by treating it as a child line.
            children.append(child)
        else:
            atoms.append(dump(child, 0))
    head = "(" + " ".join(atoms)
    if not children:
        return head + ")"
    lines = [head]
    for child in children:
        lines.append(pad + "\t" + dump(child, indent + 1))
    lines.append(pad + ")")
    return "\n".join(lines)


def _is_short(node: list) -> bool:
    """Short flat lists (``(at 1 2 0)``, ``(xy 1 2)``) stay on the parent's line."""
    return node and node[0] in {"at", "xy", "size", "length", "uuid", "start", "end", "mid", "center", "radius", "width", "type", "color", "thickness"} and not any(isinstance(c, list) for c in node)


def find(node: list, key: str) -> list | None:
    for child in node:
        if isinstance(child, list) and child and child[0] == key:
            return child
    return None


def find_all(node: list, key: str) -> list[list]:
    return [c for c in node if isinstance(c, list) and c and c[0] == key]
