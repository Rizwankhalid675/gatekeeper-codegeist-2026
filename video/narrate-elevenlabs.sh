#!/usr/bin/env bash
# Speak video/narration-script.txt with ElevenLabs, one block at a time, and
# write video/audio/NN.wav — exactly where build.py already looks for narration.
#
#   ./video/narrate-elevenlabs.sh --voices       list the voices on the account
#   ./video/narrate-elevenlabs.sh --dry-run      show what would be sent, call nothing
#   ./video/narrate-elevenlabs.sh --voice <id>   override the voice for this run
#   ./video/narrate-elevenlabs.sh                generate video/audio/NN.wav
#
# Adapted from aws-msp-hackathon/scripts/make-narration.sh, which is the hardened
# version of this and worth reading first. Same handling of the key, deliberately:
#
#   * the key is sourced from .env and NEVER echoed, logged, or written anywhere;
#   * curl reads it from a header FILE, not argv, so it cannot appear in `ps`;
#   * the header file is created with umask 077 and removed on exit;
#   * when the API refuses, the key is DESCRIBED (length, prefix, stray
#     whitespace) rather than printed, which is enough to debug a bad paste.
#
# WHERE THE KEY COMES FROM. This project has no .env of its own — this session
# cannot create one, by design. So it falls back to the ElevenLabs key already
# in the aws-msp-hackathon project. Nothing is copied: the file is sourced in
# place, read once, and never written to. If you would rather keep this
# project's keys in this project, create hackathons/codegeist-2026/.env with
# ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID and it will be preferred
# automatically.
#
# One block per shot, generated separately rather than as one long request,
# because build.py times each shot to the length of its own line. A single mp3
# would have to be split by ear.
set -euo pipefail
cd "$(dirname "$0")/.."

SCRIPT_TXT=video/narration-script.txt
OUTDIR=video/audio
API=https://api.elevenlabs.io/v1
FORMAT=mp3_44100_128

die() { echo "$*" >&2; exit 1; }

ENV_FILE="${ELEVENLABS_ENV_FILE:-}"
if [ -z "$ENV_FILE" ]; then
  if [ -f .env ]; then
    ENV_FILE=.env
  elif [ -f "$HOME/Desktop/PW/aws-msp-hackathon/.env" ]; then
    ENV_FILE="$HOME/Desktop/PW/aws-msp-hackathon/.env"
    echo "note: no .env here; using the key from aws-msp-hackathon (nothing is copied)" >&2
  else
    die "No .env found. Put ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in
hackathons/codegeist-2026/.env (chmod 600), or point ELEVENLABS_ENV_FILE at one."
  fi
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${ELEVENLABS_API_KEY:=}"
: "${ELEVENLABS_VOICE_ID:=}"
: "${ELEVENLABS_MODEL_ID:=eleven_multilingual_v2}"
[ -n "$ELEVENLABS_API_KEY" ] || die "ELEVENLABS_API_KEY is empty in $ENV_FILE"

HDR="$(mktemp)"; trap 'rm -f "$HDR"' EXIT
( umask 077; printf 'xi-api-key: %s\n' "$ELEVENLABS_API_KEY" > "$HDR" )

# Describe the key WITHOUT revealing it, for when the API rejects it.
key_shape() {
  python3 - <<'PY'
import os
k = os.environ.get("ELEVENLABS_API_KEY", "")
bits = [f"{len(k)} characters"]
if k != k.strip():             bits.append("has leading/trailing whitespace")
if any(c in k for c in "\r\n"): bits.append("contains a newline")
if k.startswith("sk_"):        bits.append("starts with sk_")
elif k:                        bits.append("does NOT start with sk_")
print("  key: " + ", ".join(bits))
PY
}

if [ "${1:-}" = "--voices" ]; then
  body_file="$(mktemp)"; trap 'rm -f "$HDR" "$body_file"' EXIT
  code=$(curl -sS -o "$body_file" -w '%{http_code}' -H @"$HDR" "$API/voices" || echo 000)
  if [ "$code" != "200" ]; then
    echo "ElevenLabs refused the request (HTTP $code)." >&2
    key_shape >&2
    head -c 300 "$body_file" >&2; echo >&2
    exit 1
  fi
  python3 - "$body_file" <<'PY'
import json, sys
for v in json.load(open(sys.argv[1])).get("voices", []) or [{"voice_id": "(none on this account)", "name": ""}]:
    labels = v.get("labels") or {}
    bits = " ".join(f"{k}={labels[k]}" for k in ("accent", "gender", "age", "use_case") if labels.get(k))
    print("  %-24s %-22s %s" % (v.get("voice_id", "?"), v.get("name", "?"), bits))
PY
  echo
  echo "Current ELEVENLABS_VOICE_ID: ${ELEVENLABS_VOICE_ID:-(unset)}"
  exit 0
fi

if [ "${1:-}" = "--voice" ]; then
  [ -n "${2:-}" ] || die "--voice needs a voice id"
  ELEVENLABS_VOICE_ID="$2"
  shift 2
fi

[ -f "$SCRIPT_TXT" ] || die "missing $SCRIPT_TXT — run: python3 video/narration.py --export"
[ -n "$ELEVENLABS_VOICE_ID" ] || die "No voice chosen. Put one in ELEVENLABS_VOICE_ID,
or pass --voice <id>. Run $0 --voices to see the ids on the account."

# Split on blank lines, one entry per shot. A read loop rather than mapfile:
# macOS ships bash 3.2, which has no mapfile.
LINES=()
while IFS= read -r __l; do [ -n "$__l" ] && LINES+=("$__l"); done < <(python3 - "$SCRIPT_TXT" <<'PY'
import sys, json
for b in [x.strip().replace("\n", " ") for x in open(sys.argv[1]).read().split("\n\n")]:
    if b:
        print(json.dumps(b))
PY
)
n=${#LINES[@]}
[ "$n" -gt 0 ] || die "no lines parsed from $SCRIPT_TXT"
printf '%s blocks, %s words, voice %s, model %s\n' \
  "$n" "$(wc -w < "$SCRIPT_TXT" | tr -d ' ')" "$ELEVENLABS_VOICE_ID" "$ELEVENLABS_MODEL_ID"

if [ "${1:-}" = "--dry-run" ]; then
  echo "dry run — nothing will be sent:"
  for i in $(seq 0 $((n-1))); do
    printf '  %2d  %s\n' "$((i+1))" \
      "$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])[:74])' "${LINES[$i]}")"
  done
  exit 0
fi

mkdir -p "$OUTDIR"
for i in $(seq 0 $((n-1))); do
  idx=$(printf '%02d' "$i")          # 00-based, to match build.py's shot index
  mp3="$OUTDIR/$idx.mp3"
  wav="$OUTDIR/$idx.wav"

  body=$(python3 -c '
import json, sys
print(json.dumps({
  "text": json.loads(sys.argv[1]),
  "model_id": sys.argv[2],
  "voice_settings": {"stability": 0.45, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True},
}))' "${LINES[$i]}" "$ELEVENLABS_MODEL_ID")

  if ! curl -fsS -X POST \
        -H @"$HDR" -H 'Content-Type: application/json' \
        --data-binary "$body" \
        "$API/text-to-speech/$ELEVENLABS_VOICE_ID?output_format=$FORMAT" \
        -o "$mp3"; then
    die "block $idx failed. Check the key, the voice id, and the quota."
  fi

  # build.py reads wav. Convert and drop the mp3 so there is one source of truth.
  ffmpeg -y -loglevel error -i "$mp3" -ac 1 -ar 44100 -c:a pcm_s16le "$wav"
  rm -f "$mp3"

  bytes=$(wc -c < "$wav" | tr -d ' ')
  [ "$bytes" -gt 20000 ] || die "block $idx produced $bytes bytes: no usable audio"
  printf '  %s  %6ss  %s\n' "$idx" \
    "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav" | cut -d. -f1-2)" \
    "$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])[:56])' "${LINES[$i]}")"
done

echo
echo "wrote $n files to $OUTDIR. Now: python3 video/build.py"
