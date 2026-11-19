#!/usr/bin/env python3
"""
build.py — assemble the Codegeist demo video from real captures of the live app.

What this is, stated plainly because it matters: this is NOT a screen recording.
Every image in it is a real, unretouched capture of Gatekeeper running on
one-atlas-vwgf.atlassian.net, but they are stills, cut together with captions.
Nothing is a mock-up and no screenshot has been edited, with one exception that
is labelled on screen: the Atlassian accountIds in the rule pack history are
masked, because the video is going somewhere public.

Pipeline: each shot is composed as an SVG (caption text drawn over a base64
embedded capture), rendered to PNG by rsvg-convert, and sequenced by ffmpeg.
It is done this way because this machine's ffmpeg was built without libfreetype,
so drawtext and the subtitles filter are both unavailable.

    python3 video/build.py

Writes video/gatekeeper-demo.mp4.
"""

import base64
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FRAMES = ROOT / 'frames'
BUILD = ROOT / 'build'
OUT = ROOT / 'gatekeeper-demo.mp4'

W, H = 1920, 1080
FPS = 30

BG = '#0d1117'
PANEL = '#161b22'
INK = '#ffffff'
MUTED = '#8b9bb4'
ACCENT = '#4c9aff'
WARN = '#f5a623'
GOOD = '#57d9a3'

SANS = 'Helvetica Neue'
MONO = 'Menlo'

# Image box: everything is fitted inside this, centred, aspect preserved.
BOX = (150, 70, 1620, 700)


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def embed(path):
    data = base64.b64encode(pathlib.Path(path).read_bytes()).decode()
    kind = 'png' if str(path).lower().endswith('.png') else 'jpeg'
    return f'data:image/{kind};base64,{data}'


def image_size(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split(',')[:2]
    return int(w), int(h)


def fit(iw, ih):
    bx, by, bw, bh = BOX
    scale = min(bw / iw, bh / ih)
    w, h = iw * scale, ih * scale
    return bx + (bw - w) / 2, by + (bh - h) / 2, w, h


def caption(kicker, head, sub):
    """The lower third. One kicker, one headline, at most one supporting line."""
    parts = []
    if kicker:
        parts.append(
            f'<text x="150" y="838" font-family="{SANS}" font-size="24" font-weight="700" '
            f'letter-spacing="3" fill="{ACCENT}">{esc(kicker.upper())}</text>')
    if head:
        parts.append(
            f'<text x="150" y="905" font-family="{SANS}" font-size="46" font-weight="600" '
            f'fill="{INK}">{esc(head)}</text>')
    if sub:
        parts.append(
            f'<text x="150" y="960" font-family="{SANS}" font-size="31" fill="{MUTED}">{esc(sub)}</text>')
    return '\n'.join(parts)


def chrome(progress):
    """Footer mark and a progress rule, so a judge can see how long is left."""
    bar_w = int(1620 * progress)
    return f'''
<rect x="150" y="1016" width="1620" height="3" fill="#21262d"/>
<rect x="150" y="1016" width="{bar_w}" height="3" fill="{ACCENT}"/>
<text x="150" y="1052" font-family="{SANS}" font-size="20" fill="#5a6b85">Gatekeeper — Atlassian Forge — Codegeist 2026</text>
<text x="1770" y="1052" text-anchor="end" font-family="{SANS}" font-size="20" fill="#5a6b85">one-atlas-vwgf.atlassian.net — live</text>'''


def shot_image(path, kicker, head, sub, masks=(), progress=0.0):
    iw, ih = image_size(path)
    x, y, w, h = fit(iw, ih)
    mask_svg = []
    for (mx, my, mw, mh) in masks:
        rx, ry = x + mx * w, y + my * h
        rw, rh = mw * w, mh * h
        mask_svg.append(
            f'<rect x="{rx:.1f}" y="{ry:.1f}" width="{rw:.1f}" height="{rh:.1f}" rx="5" fill="#2b3340"/>'
            f'<text x="{rx + rw / 2:.1f}" y="{ry + rh * 0.74:.1f}" text-anchor="middle" '
            f'font-family="{MONO}" font-size="{rh * 0.58:.0f}" fill="#8b9bb4">accountId masked</text>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{BG}"/>
<rect x="{x - 10:.1f}" y="{y - 10:.1f}" width="{w + 20:.1f}" height="{h + 20:.1f}" rx="12" fill="#ffffff"/>
<image xlink:href="{embed(path)}" x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}"/>
{chr(10).join(mask_svg)}
{caption(kicker, head, sub)}
{chrome(progress)}
</svg>'''


def shot_title(head, sub, progress=0.0):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{BG}"/>
<text x="150" y="470" font-family="{SANS}" font-size="104" font-weight="700" fill="{INK}">{esc(head)}</text>
<rect x="152" y="520" width="120" height="6" fill="{ACCENT}"/>
<text x="150" y="610" font-family="{SANS}" font-size="38" fill="{MUTED}">{esc(sub)}</text>
{chrome(progress)}
</svg>'''


def shot_quote(quote, attrib, progress=0.0):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{BG}"/>
<text x="150" y="420" font-family="{SANS}" font-size="30" font-weight="700" letter-spacing="3" fill="{WARN}">THE AGENT WROTE</text>
<text x="150" y="530" font-family="{SANS}" font-size="56" font-weight="600" fill="{INK}">&#8220;Critical failure in the production</text>
<text x="150" y="602" font-family="{SANS}" font-size="56" font-weight="600" fill="{INK}">database connection pool.&#8221;</text>
<text x="150" y="700" font-family="{SANS}" font-size="34" fill="{MUTED}">{esc(attrib)}</text>
{chrome(progress)}
</svg>'''


def shot_lines(kicker, head, lines, progress=0.0, accent=ACCENT):
    body = []
    yy = 440
    for text, colour in lines:
        body.append(f'<text x="150" y="{yy}" font-family="{SANS}" font-size="36" fill="{colour}">{esc(text)}</text>')
        yy += 62
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="{BG}"/>
<text x="150" y="270" font-family="{SANS}" font-size="26" font-weight="700" letter-spacing="3" fill="{accent}">{esc(kicker.upper())}</text>
<text x="150" y="352" font-family="{SANS}" font-size="60" font-weight="600" fill="{INK}">{esc(head)}</text>
{chr(10).join(body)}
{chrome(progress)}
</svg>'''


def shot_arch(progress=0.0):
    """The trust boundary, drawn rather than screenshotted — it is a diagram and reads as one."""
    rows = [
        ('CORRELATION', 'deterministic — decides what deserves a human at all', GOOD, 'TRUSTED'),
        ('TWO ROVO AGENTS', 'proposer and adversarial reviewer — load-bearing, never authority', WARN, 'UNTRUSTED'),
        ('THE GATE — 12 RULES', 'a pure function; reject beats hold beats auto', GOOD, 'TRUSTED'),
        ('EXECUTOR', 're-derives the verdict itself; five allow-listed effects', GOOD, 'TRUSTED'),
        ('RECEIPT CHAIN', 'sha256, append-only, verified on screen', GOOD, 'TRUSTED'),
    ]
    out = [f'<rect width="{W}" height="{H}" fill="{BG}"/>',
           f'<text x="150" y="150" font-family="{SANS}" font-size="26" font-weight="700" letter-spacing="3" fill="{ACCENT}">THE SHAPE OF IT</text>',
           f'<text x="150" y="226" font-family="{SANS}" font-size="56" font-weight="600" fill="{INK}">Three trust levels, and only one of them may decide</text>']
    y = 300
    for name, desc, colour, tag in rows:
        out.append(f'<rect x="150" y="{y}" width="1480" height="104" rx="10" fill="{PANEL}" stroke="#21262d"/>')
        out.append(f'<rect x="150" y="{y}" width="7" height="104" rx="3" fill="{colour}"/>')
        out.append(f'<text x="196" y="{y + 44}" font-family="{SANS}" font-size="31" font-weight="700" fill="{INK}">{esc(name)}</text>')
        out.append(f'<text x="196" y="{y + 82}" font-family="{SANS}" font-size="26" fill="{MUTED}">{esc(desc)}</text>')
        out.append(f'<text x="1600" y="{y + 60}" text-anchor="end" font-family="{MONO}" font-size="22" fill="{colour}">{tag}</text>')
        y += 122
    out.append(chrome(progress))
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">{"".join(out)}</svg>'


# --- the cut ----------------------------------------------------------------
# (builder, args, seconds)
SHOTS = [
    (shot_title, ('Gatekeeper',
                  'The model proposes. Deterministic code decides. Nothing executes without a receipt.'), 7),

    (shot_image, (FRAMES / '01-issue.png', 'the incident',
                  'This is the entire issue.',
                  'Summary: "Issue xyz". Description: "issue with this thing".'), 10),

    (shot_image, (FRAMES / '03-evidence.png', 'what the agents were shown',
                  'Two lines of source evidence, hashed before any model runs.',
                  'Gatekeeper\'s own comment is marked derived — one model cannot corroborate another.'), 13),

    (shot_quote, ('', 'about an issue whose entire description is "issue with this thing"'), 9),

    (shot_image, (FRAMES / '06-receipts.png', 'the audit trail',
                  'Receipt 000002: executed. "All eleven rules passed."',
                  'It posted an outage that does not exist, and every rule agreed.'), 14),

    (shot_lines, ('the fix', 'So the gate got a twelfth rule', [
        ('R08 verified the reviewer\'s citations and took the proposer\'s on trust.', MUTED),
        ('That is backwards: the proposer is the one asking to act.', MUTED),
        ('R12 — Proposal citations appear in source evidence.', INK),
    ]), 12),

    (shot_image, (FRAMES / '04-verdict-fired.png', 'the same issue, re-run today',
                  'Held by R07 and R12.',
                  '"1 of 1 citation(s) are not in the source evidence."'), 13),

    (shot_image, (FRAMES / '05-verdict-twelve.png', 'every rule, every time',
                  'Ten passed, two fired, all twelve reported.',
                  'An operator can see the hold was specific rather than a blanket refusal.'), 14),

    (shot_arch, (), 13),

    (shot_image, (FRAMES / '07-editor-top.png', 'a project is a rule pack',
                  'Onboarding a team is authoring one of these, not changing code.',
                  'Unattended action is off by default — somebody has to choose otherwise.'), 12),

    (shot_image, (FRAMES / '08-actions-ceilings.png', 'ceilings',
                  'Comment and label may run unattended. Transition and assign never do.',
                  'R05 caps an action however confident the model claims to be.'), 13),

    (shot_image, (FRAMES / '09-add-action.png', 'the allow-list',
                  'Five effects — the executor\'s whole dispatch table.',
                  'A new action arrives capped at hold; clearing it is a separate, deliberate click.'), 13),

    (shot_image, (FRAMES / '10-history.png', 'who changed the rules',
                  'Every rule pack change is a receipt, chained by sha256.',
                  'The diff says whether a change widened what a robot may do.',
                  # Masks over the Atlassian accountIds, in fractions of the capture.
                  # The first row's chip starts further right than the other two.
                  ((0.082, 0.165, 0.280, 0.068), (0.076, 0.450, 0.281, 0.068), (0.076, 0.735, 0.281, 0.068))), 14),

    (shot_image, (FRAMES / '11-conflict.jpg', 'two administrators, two tabs',
                  '"You are changing v8, but CLSD is now at v9. Nothing was saved."',
                  'A tightening made after an incident survives somebody else\'s stale tab.'), 13),

    (shot_lines, ('what I will not claim', 'The limits, written before you asked', [
        ('The traffic is a demo site. There is no measured noise-reduction number,', MUTED),
        ('because an honest one needs a real queue with real labels.', MUTED),
        ('R12 checks that a citation exists — not that it supports the conclusion.', MUTED),
        ('Forge storage has no compare-and-swap, so the conflict check is a check,', MUTED),
        ('not a guarantee. All of it is in docs/LIMITS.md.', INK),
    ]), 15, ),

    (shot_lines, ('the build', '169 tests, no Forge runtime, no network', [
        ('The gate is a pure function: no clock, no storage, no network.', MUTED),
        ('The executor re-derives its own authorisation and ignores the verdict handed to it.', MUTED),
        ('Every screenshot in this video is the app running on a real Jira site.', INK),
    ]), 12),

    (shot_title, ('The model cannot talk its way past it',
                  'Repo and install link are on the submission.'), 8),
]


def build():
    if not shutil.which('rsvg-convert'):
        sys.exit('rsvg-convert is required')
    BUILD.mkdir(exist_ok=True)
    for old in BUILD.glob('*'):
        old.unlink()

    total = sum(s[2] for s in SHOTS)
    elapsed = 0.0
    entries = []

    for i, (fn, args, secs) in enumerate(SHOTS):
        progress = elapsed / total
        if fn is shot_image:
            path, kicker, head, sub = args[0], args[1], args[2], args[3]
            masks = args[4] if len(args) > 4 else ()
            svg = shot_image(path, kicker, head, sub, masks, progress)
        elif fn is shot_arch:
            svg = shot_arch(progress)
        elif fn is shot_title:
            svg = shot_title(*args, progress=progress)
        elif fn is shot_quote:
            svg = shot_quote(*args, progress=progress)
        else:
            svg = shot_lines(*args, progress=progress)

        svg_path = BUILD / f'{i:02d}.svg'
        png_path = BUILD / f'{i:02d}.png'
        svg_path.write_text(svg)
        subprocess.run(['rsvg-convert', '-w', str(W), '-h', str(H), str(svg_path), '-o', str(png_path)], check=True)
        entries.append((png_path, secs))
        elapsed += secs
        print(f'  shot {i:02d}  {secs:>2}s  {png_path.name}')

    concat = BUILD / 'concat.txt'
    lines = []
    for png, secs in entries:
        lines.append(f"file '{png.name}'")
        lines.append(f'duration {secs}')
    lines.append(f"file '{entries[-1][0].name}'")  # concat demuxer needs the last frame repeated
    concat.write_text('\n'.join(lines) + '\n')

    # A silent AAC track. The video has no narration, and some players and
    # upload pipelines behave oddly with a video-only MP4.
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', str(concat),
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-vf', f'fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st={total - 0.8}:d=0.8',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
        '-c:a', 'aac', '-b:a', '96k', '-shortest',
        '-movflags', '+faststart',
        str(OUT),
    ], check=True, cwd=BUILD)

    write_srt()
    print(f'\n{OUT}  —  {total}s ({total // 60}:{total % 60:02d})')


def write_srt():
    """
    Subtitles matching the on-screen captions.

    Two uses: upload them with the video so it is watchable with sound off and
    searchable, and use the timings as the cue sheet if a voice-over is recorded
    over this cut later.
    """
    def ts(seconds):
        h, rem = divmod(int(seconds), 3600)
        m, s = divmod(rem, 60)
        ms = int((seconds - int(seconds)) * 1000)
        return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

    lines, t, n = [], 0.0, 1
    for fn, args, secs in SHOTS:
        if fn is shot_image:
            text = f'{args[2]}\n{args[3]}'
        elif fn is shot_title:
            text = f'{args[0]}\n{args[1]}'
        elif fn is shot_quote:
            text = ('"Critical failure in the production database connection pool." '
                    '— ' + args[1])
        elif fn is shot_arch:
            text = 'Three trust levels, and only one of them may decide.'
        else:
            text = args[1] + '\n' + ' '.join(t for t, _ in args[2])
        lines.append(f'{n}\n{ts(t)} --> {ts(t + secs - 0.3)}\n{text}\n')
        t += secs
        n += 1
    (ROOT / 'gatekeeper-demo.srt').write_text('\n'.join(lines))


if __name__ == '__main__':
    build()
