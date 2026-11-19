#!/usr/bin/env python3
"""
narration.py — the spoken script, and the local text-to-speech that reads it.

One line per shot in build.py's SHOTS, same order. The text here is written to
be HEARD, not read: rule ids, digests and version numbers are spelled the way a
synthesiser gets them right ("rule R twelve", not "R12"), while the captions on
screen keep the real spelling. If you change a shot in build.py, change the line
here, and the two asserts will tell you if they drift apart.

Synthesis is macOS's own `say`, which runs entirely on this machine — no API
key, nothing sent to any service, and no cost. It must run OUTSIDE the Bash
sandbox: inside it, `say` exits 0 and writes a 4 KB file containing no audio,
which is the kind of silent success worth knowing about.

    python3 video/narration.py        # writes video/audio/NN.wav

Then `python3 video/build.py` picks the files up and times the cut to them.
"""

import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
AUDIO = ROOT / 'audio'

VOICE = 'Daniel'   # en_GB; the written register is British, so the read matches
RATE = 168         # words per minute. Slower than the 175 default: this is dense material.

LINES = [
    # 0 — title
    "This is Gatekeeper. It is a Forge app for incident triage in Jira Service Management, "
    "and it is built on one rule. The model proposes. Deterministic code decides. "
    "And nothing executes without a receipt.",

    # 1 — the issue
    "Here is the incident. This is not an excerpt. It is the entire issue. "
    "The summary reads, issue X Y Z. The description reads, issue with this thing. "
    "There is nothing else in it.",

    # 2 — evidence
    "Before any model is asked anything, Gatekeeper gathers the evidence and hashes it. "
    "Two lines of source evidence, taken from Jira itself. "
    "Notice the third item is marked derived. That is Gatekeeper's own comment, and it can never "
    "count as corroboration, because one model may not vouch for another.",

    # 3 — the fabrication
    "And this is what the agent wrote about that issue. "
    "A critical failure in the production database connection pool. "
    "There is no outage. There is no database. The model invented it, at ninety percent confidence.",

    # 4 — the receipts
    "Here is the audit trail, and here is the uncomfortable part. "
    "Receipt number two. Executed. All eleven rules passed. "
    "The old gate verified the reviewer's citations and took the proposing agent's on trust, "
    "so an invented outage was posted to a real issue, and every rule agreed.",

    # 5 — the fix
    "So the gate got a twelfth rule. "
    "Rule R twelve re-checks the proposing agent's citations against the source evidence. "
    "Deterministically, in trusted code, after the model has finished talking.",

    # 6 — re-run
    "The same issue, re-run today. Held by rule R seven and rule R twelve. "
    "One of one citation is not in the source evidence. "
    "The hold names the rule, and the rule names the reason.",

    # 7 — all twelve
    "Every rule is evaluated on every decision, and every rule is reported. "
    "The ten that passed, as well as the two that fired. "
    "An operator reading a hold at three in the morning needs to see that the refusal was specific, "
    "rather than a blanket no.",

    # 8 — architecture
    "The architecture is three trust levels. "
    "Correlation is deterministic, and decides what deserves a human at all before a model is asked anything. "
    "The two Rovo agents are untrusted. Delete them and there is no diagnosis, but they are never the authority. "
    "The gate and the executor are deterministic, and only they may decide.",

    # 9 — rule pack
    "A project is a rule pack. Onboarding a team means authoring one of these, not changing code. "
    "Unattended action is off by default, so installing this app changes nothing about your incident queue "
    "until somebody deliberately chooses otherwise.",

    # 10 — ceilings
    "Each action has a ceiling. Here, commenting and labelling may run unattended. "
    "Transitioning an issue and assigning one never do. "
    "Rule R five caps an action however confident the model claims to be. That is the knob a team actually turns.",

    # 11 — allow list
    "Five effects. That is the executor's entire dispatch table, "
    "and there is no path from a model's output to any other Jira call. "
    "A new action arrives capped at hold. Clearing it for unattended use is a separate, deliberate click.",

    # 12 — who changed the rules
    "Gatekeeper used to record every action a robot took, and nothing at all about the person "
    "who decided what robots may do. Now every rule pack change is a receipt too, "
    "chained by S H A two fifty six. And the difference says whether the change widened "
    "what a robot is allowed to do.",

    # 13 — lost update
    "Two administrators can no longer quietly overwrite each other. "
    "This tab was editing version eight. The pack had already moved to version nine. "
    "The save is refused and nothing is written, so a tightening made after an incident "
    "survives somebody else's stale tab.",

    # 14 — limits
    "What I will not claim. The traffic here is a demo site. "
    "There is no measured noise reduction number, because an honest one needs a real queue with real labels. "
    "Rule R twelve checks that a citation exists. Not that it supports the conclusion drawn from it. "
    "All of it is written down in the limits document.",

    # 15 — the build
    "A hundred and sixty nine tests. No Forge runtime, no network, and no credentials needed to run them. "
    "The gate is a pure function. "
    "The executor re-derives its own authorisation, and ignores the verdict it was handed.",

    # 16 — close
    "The model proposes. Deterministic code decides. "
    "And the model cannot talk its way past it.",
]


def synthesise():
    AUDIO.mkdir(exist_ok=True)
    for i, line in enumerate(LINES):
        out = AUDIO / f'{i:02d}.wav'
        subprocess.run(
            ['say', '-v', VOICE, '-r', str(RATE),
             '--file-format=WAVE', '--data-format=LEI16@44100',
             '-o', str(out), line],
            check=True)
        size = out.stat().st_size
        # `say` exits 0 and writes a 4 KB stub when the speech service is
        # unreachable — inside the Bash sandbox, for instance. Catch it here
        # rather than discovering a silent video later.
        if size < 20000:
            sys.exit(f'{out.name} is {size} bytes: no audio was synthesised. '
                     f'Run this outside the sandbox.')
        dur = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'csv=p=0', str(out)],
            capture_output=True, text=True, check=True).stdout.strip()
        print(f'  {i:02d}  {float(dur):5.1f}s  {len(line.split()):3d} words')

    total = sum(
        float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                              '-of', 'csv=p=0', str(AUDIO / f"{i:02d}.wav")],
                             capture_output=True, text=True, check=True).stdout.strip())
        for i in range(len(LINES)))
    print(f'\nspoken total {total:.0f}s ({int(total) // 60}:{int(total) % 60:02d}) before padding')


if __name__ == '__main__':
    synthesise()
