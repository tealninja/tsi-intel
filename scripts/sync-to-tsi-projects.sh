#!/usr/bin/env sh
# Mirror tsi-intel.html into the tsi-projects repo, where it is served at
# https://tsiprojects.bodhistoys.com/tsi-intel/ behind the shared passcode.
#   usage: scripts/sync-to-tsi-projects.sh [path-to-tsi-projects]   (default ../tsi-projects)
# Appends the hub widget script and sets versions.json["tsi-intel"] to 1.<APP_BUILD>.0,
# then prints the git status in tsi-projects. Commit and push main there to deploy.
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
DEST=${1:-"$HERE/../tsi-projects"}
[ -f "$DEST/hub.js" ] || { echo "tsi-projects not found at $DEST" >&2; exit 1; }
BUILD=$(grep -o "const APP_BUILD = '#[0-9]*" "$HERE/tsi-intel.html" | grep -o '[0-9]*$')
mkdir -p "$DEST/tsi-intel"
python3 - "$HERE/tsi-intel.html" "$DEST/tsi-intel/index.html" "$DEST/versions.json" "$BUILD" <<'PY'
import sys, json
src, dst, vers, build = sys.argv[1:]
html = open(src, encoding='utf-8').read()
i = html.rindex('</body>')   # the document's own closing tag (templates earlier in the file also contain one)
open(dst, 'w', encoding='utf-8').write(html[:i] + '<script src="/hub.js"></script>\n' + html[i:])
v = json.load(open(vers)); v['tsi-intel'] = f'1.{build}.0'
open(vers, 'w').write(json.dumps(v, indent=2) + '\n')
print(f'synced build #{build} -> {dst} ; versions.json tsi-intel = 1.{build}.0')
PY
git -C "$DEST" status --short tsi-intel versions.json
