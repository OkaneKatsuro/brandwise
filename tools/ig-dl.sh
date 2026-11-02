#!/usr/bin/env bash
# Read public Instagram content with Instaloader (https://instaloader.github.io), anonymously by default.
# Usage: tools/ig-dl.sh post <url|shortcode>...          one post or reel
#        tools/ig-dl.sh profile <username> [--count N]   latest posts of a public profile (default 12)
#        tools/ig-dl.sh hashtag <tag> [--count N]        recent posts of a hashtag (default 12; Instagram often wants a login for this)
# stdout: one absolute path per saved file of the target, newest first. Logs: stderr. Each post also gets a <name>.json (caption, likes, comments, owner).
# Files go to <repo>/downloads/instagram/<target>/. Optional login with a THROWAWAY account (never your main one):
#   IG_LOGIN=<username> tools/ig-dl.sh ...   (Instaloader asks for the password once and keeps a session file)
# shortcut: no own request pacing beyond Instaloader's built-in rate controller; keep --count small, upgrade if Instagram blocks the IP.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
root="$(cd "$(dirname "$0")/.." && pwd)"
"$root/tools/bootstrap.sh" >&2

mode="${1:-}"; [ $# -gt 0 ] && shift
count=12; targets=()
while [ $# -gt 0 ]; do
  case "$1" in
    --count) count="${2:?--count needs a number}"; shift ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) targets+=("$1") ;;
  esac
  shift
done
[ ${#targets[@]} -gt 0 ] || { sed -n '3,5p' "$0" >&2; exit 2; }

out="$root/downloads/instagram"
login=(--quiet); [ -n "${IG_LOGIN:-}" ] && login=(--login "$IG_LOGIN")  # --quiet would block the password prompt
common=(--no-compress-json --no-profile-pic --dirname-pattern "$out/{target}" --filename-pattern "{date_utc:%Y%m%d}_{shortcode}")

for t in "${targets[@]}"; do
  case "$mode" in
    post)
      code="$(printf '%s' "$t" | sed -E 's#.*/(p|reel|reels|tv)/([A-Za-z0-9_-]+).*#\2#')"  # a bare shortcode passes through
      instaloader "${common[@]}" ${login[@]+"${login[@]}"} -- "-$code" >&2
      dir="$out/-$code" ;;
    profile)
      # --count does not apply to profiles in the CLI, so cap the posts through the library of the same install
      "$(head -1 "$(command -v instaloader)" | sed 's/^#!//')" - "$t" "$count" "$out" "${IG_LOGIN:-}" >&2 <<'PY'
import itertools, sys, instaloader
user, count, out, login = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
L = instaloader.Instaloader(dirname_pattern=out + "/{target}", filename_pattern="{date_utc:%Y%m%d}_{shortcode}", download_geotags=False,
                            download_comments=False, save_metadata=True, compress_json=False, post_metadata_txt_pattern="{caption}", quiet=True)
if login: L.load_session_from_file(login)
for post in itertools.islice(instaloader.Profile.from_username(L.context, user).get_posts(), count): L.download_post(post, target=user)
PY
      dir="$out/$t" ;;
    hashtag) instaloader "${common[@]}" ${login[@]+"${login[@]}"} --count "$count" -- "#${t#\#}" >&2; dir="$out/#${t#\#}" ;;
    *) echo "mode must be post, profile or hashtag" >&2; exit 2 ;;
  esac
  # everything saved for this target (Instaloader skips files it already has, so this includes earlier runs), newest first
  find "$dir" -type f ! -name '*.txt' 2>/dev/null | sort -r || true
done
