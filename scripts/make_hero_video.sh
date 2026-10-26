#!/usr/bin/env bash
# Make the Home hero band files (spec section 9, "Home hero band") from the
# owner's source clips. Run on a Mac with ffmpeg and cwebp (Homebrew: ffmpeg, webp):
#
#   scripts/make_hero_video.sh <light.mp4> <dark.mp4>
#
# Writes public/video/home-hero-{light,dark}.{webm,mp4} and the first- and
# last-frame stills home-hero-{light,dark}-{first,last}.webp.

set -euo pipefail

light="${1:?Usage: make_hero_video.sh <light.mp4> <dark.mp4>}"
dark="${2:?Usage: make_hero_video.sh <light.mp4> <dark.mp4>}"

out="$(cd "$(dirname "$0")/.." && pwd)/public/video"
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

scale="scale=1280:-2"

for theme in light dark; do
  if [[ "$theme" == light ]]; then src="$light"; else src="$dark"; fi
  base="$out/home-hero-$theme"
  echo "==> $theme: $src"

  # VP9 WebM, no audio. Two-pass gives a smaller file at the same quality.
  ffmpeg -hide_banner -loglevel error -y -i "$src" -vf "$scale" -an \
    -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -pass 1 -passlogfile "$tmp/vp9" -f null /dev/null
  ffmpeg -hide_banner -loglevel error -y -i "$src" -vf "$scale" -an \
    -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -pass 2 -passlogfile "$tmp/vp9" "$base.webm"

  # H.264 MP4 fallback (Safari before VP9 support), metadata first so it starts quickly.
  ffmpeg -hide_banner -loglevel error -y -i "$src" -vf "$scale" -an \
    -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart "$base.mp4"

  # Stills: the first frame, and the last (-update 1 keeps overwriting one file,
  # so what remains is the final frame).
  ffmpeg -hide_banner -loglevel error -y -i "$src" -vf "$scale" -frames:v 1 "$tmp/first.png"
  ffmpeg -hide_banner -loglevel error -y -i "$src" -vf "$scale" -update 1 "$tmp/last.png"
  cwebp -quiet -q 72 "$tmp/first.png" -o "$base-first.webp"
  cwebp -quiet -q 72 "$tmp/last.png" -o "$base-last.webp"
done

ls -lh "$out"
