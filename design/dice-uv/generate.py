"""Generate Photoshop UV guides from the original Dice Box mesh (requires Pillow).

Run after rasterizing dice/themes/nest/numbers.svg to nest-texture.png at 1024px.
Original texture/model assets are read only.
"""
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SIZE = 1024
SCALE = 4


def edge_key(a, b):
    return tuple(sorted((tuple(round(x, 4) for x in a), tuple(round(x, 4) for x in b))))


def mesh_edges(mesh):
    triangles = []
    for offset in range(0, len(mesh['indices']), 3):
        ids = mesh['indices'][offset:offset + 3]
        points = [mesh['positions'][i * 3:i * 3 + 3] for i in ids]
        a = [points[1][i] - points[0][i] for i in range(3)]
        b = [points[2][i] - points[0][i] for i in range(3)]
        normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
        area = math.sqrt(sum(v*v for v in normal))
        uv = [(mesh['uvs'][i*2]*SIZE, (1-mesh['uvs'][i*2+1])*SIZE) for i in ids]
        triangles.append((area, [v/area for v in normal] if area else normal, uv))
    largest = max(t[0] for t in triangles)
    face_edges = defaultdict(list)
    all_edges = set()
    for area, normal, uv in triangles:
        for a, b in zip(uv, uv[1:] + uv[:1]):
            if math.dist(a, b) < 0.01:
                continue
            edge = edge_key(a, b)
            all_edges.add(edge)
            # Broad planar triangles form the paintable faces; tiny triangles
            # are the rounded bevel. Keep bevels in the optional wireframe.
            if area > largest * 0.1:
                face_edges[edge].append(normal)
    outline = []
    for edge, normals in face_edges.items():
        if len(normals) == 1 or any(sum(a*b for a, b in zip(normals[0], n)) < 0.9999 for n in normals[1:]):
            outline.append(edge)
    return outline, all_edges


def draw_edges(edges, wire=False):
    image = Image.new('RGBA', (SIZE*SCALE, SIZE*SCALE))
    draw = ImageDraw.Draw(image)
    for a, b in sorted(edges):
        xy = [(x*SCALE, y*SCALE) for x, y in (a, b)]
        if not wire:
            draw.line(xy, fill=(0, 32, 45, 230), width=3*SCALE)
        draw.line(xy, fill=(255, 90, 190, 170) if wire else (0, 225, 255, 255), width=2 if wire else SCALE)
    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def u16(x): return struct.pack('>H', x)
def u32(x): return struct.pack('>I', x)


def save_psd(path, layers, merged):
    """PSD v1, RGB/8, uncompressed channels, named transparent layers.

    layers are in Photoshop's top-to-bottom order: (ASCII name, RGBA, visible).
    """
    records, pixels = [], []
    for name, im, visible in layers:
        channels = im.convert('RGBA').split()
        record = struct.pack('>iiiiH', 0, 0, SIZE, SIZE, 4)
        for channel_id in (0, 1, 2, -1):
            record += struct.pack('>hI', channel_id, SIZE*SIZE + 2)
        encoded = name.encode('ascii')[:255]
        pascal = bytes([len(encoded)]) + encoded
        pascal += b'\0' * (-len(pascal) % 4)
        extra = u32(0) + u32(0) + pascal
        record += b'8BIMnorm' + bytes([255, 0, 0 if visible else 2, 0]) + u32(len(extra)) + extra
        records.append(record)
        pixels.extend(u16(0) + ch.tobytes() for ch in channels)
    info = struct.pack('>h', len(layers)) + b''.join(records) + b''.join(pixels)
    info += b'\0' * (len(info) % 2)
    layer_section = u32(len(info)) + info + u32(0)
    header = b'8BPS' + u16(1) + b'\0'*6 + u16(3) + u32(SIZE) + u32(SIZE) + u16(8) + u16(3)
    composite = u16(0) + b''.join(ch.tobytes() for ch in merged.convert('RGB').split())
    path.write_bytes(header + u32(0) + u32(0) + u32(len(layer_section)) + layer_section + composite)


model = json.loads((ROOT / 'dice/vendor/dice-box/assets/themes/default/default.json').read_text())
texture = Image.open(HERE / 'nest-texture.png').convert('RGBA')
assert texture.size == (SIZE, SIZE)
layers = []
wire_edges = set()
for mesh in model['meshes']:
    if mesh['name'].endswith('_collider'):
        continue
    edges, wire = mesh_edges(mesh)
    wire_edges.update(wire)
    layer = draw_edges(edges)
    layers.append((f'UV edges - {mesh["name"]}', layer, True))
    print(mesh['name'], len(edges), 'face boundary segments')
wire = draw_edges(wire_edges, wire=True)
overlay = Image.new('RGBA', texture.size)
for _, layer, _ in reversed(layers):
    overlay = Image.alpha_composite(overlay, layer)
preview = Image.alpha_composite(texture, overlay)
overlay.save(HERE / 'nest-uv-overlay.png')
preview.save(HERE / 'nest-texture-with-grid.png')
wire.save(HERE / 'nest-uv-triangulation.png')
save_psd(HERE / 'nest-texture-edit.psd', [('Triangulation + bevels (optional)', wire, False)] + layers + [('Nest texture - edit this', texture, True)], preview)
# Pillow independently decodes the PSD's merged image and dimensions.
with Image.open(HERE / 'nest-texture-edit.psd') as psd:
    assert psd.size == texture.size
    assert psd.convert('RGB').tobytes() == preview.convert('RGB').tobytes()
print('PSD merged image verified against PNG preview.')
