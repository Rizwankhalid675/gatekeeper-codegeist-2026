#!/usr/bin/env python3
"""
mask-accountids.py — black out Atlassian accountIds in committed screenshots.

This repo is public. Two screenshots showed a real accountId in full: the rule
pack change history renders the actor as `user:<accountId>`, which is the whole
point of that feature and exactly the thing not to publish. An accountId is an
opaque identifier rather than a name or an email, but it is stable and it
identifies one person across every Atlassian site they touch, so it does not
belong in a public repo.

The video already masks these at composition time (see video/build.py). This
does the same to the source images, so the raw frames are safe on their own.

Idempotent: masking an already-masked image just redraws the same box.

    python3 scripts/mask-accountids.py

Regions are fractions of each image, so they survive the image being rescaled.
"""

import base64
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# path -> list of (x, y, w, h) as fractions of the image
TARGETS = {
    # The README's hero image: the receipt chain's Actor column names the human
    # who overrode the gate, twice, over two wrapped lines each.
    'docs/img/beats/03-receipt-chain-held-failed-overridden.jpg': [
        (0.2630, 0.8230, 0.1030, 0.0660),
        (0.2630, 0.9700, 0.1030, 0.0300),
    ],
    'docs/img/beats/06-rulepack-change-receipts.jpg': [
        (0.2335, 0.7284, 0.1880, 0.0300),
    ],
    'video/frames/10-history.png': [
        (0.082, 0.165, 0.280, 0.068),
        (0.076, 0.450, 0.281, 0.068),
        (0.076, 0.735, 0.281, 0.068),
    ],
}


def size(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split(',')[:2]
    return int(w), int(h)


def mask(rel, boxes):
    path = ROOT / rel
    if not path.exists():
        print(f'  skip (missing): {rel}')
        return
    w, h = size(path)
    kind = 'png' if path.suffix.lower() == '.png' else 'jpeg'
    data = base64.b64encode(path.read_bytes()).decode()

    label = 'accountId masked'
    rects = []
    for (fx, fy, fw, fh) in boxes:
        x, y, bw, bh = fx * w, fy * h, fw * w, fh * h
        # Fit the label to the box on BOTH axes. Sizing on height alone
        # overflows a short, wide box and the text spills onto the columns
        # either side — which looks like a rendering bug rather than a redaction.
        # Menlo's advance is about 0.6em per character.
        font = min(bh * 0.56, bw / (len(label) * 0.62))
        rects.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="4" fill="#2b3340"/>'
            f'<text x="{x + bw / 2:.1f}" y="{y + bh / 2 + font * 0.36:.1f}" text-anchor="middle" '
            f'font-family="Menlo" font-size="{font:.1f}" fill="#8b9bb4">{label}</text>')

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           f'width="{w}" height="{h}">'
           f'<image xlink:href="data:image/{kind};base64,{data}" x="0" y="0" width="{w}" height="{h}"/>'
           f'{"".join(rects)}</svg>')

    tmp_svg = path.with_suffix('.mask.svg')
    tmp_png = path.with_suffix('.mask.png')
    tmp_svg.write_text(svg)
    subprocess.run(['rsvg-convert', '-w', str(w), '-h', str(h), str(tmp_svg), '-o', str(tmp_png)], check=True)

    if path.suffix.lower() in ('.jpg', '.jpeg'):
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(tmp_png),
                        '-q:v', '3', str(path)], check=True)
    else:
        tmp_png.replace(path)
    tmp_svg.unlink(missing_ok=True)
    tmp_png.unlink(missing_ok=True)
    print(f'  masked {len(boxes)} region(s): {rel}')


if __name__ == '__main__':
    if not subprocess.run(['which', 'rsvg-convert'], capture_output=True).stdout:
        sys.exit('rsvg-convert is required')
    for rel, boxes in TARGETS.items():
        mask(rel, boxes)
