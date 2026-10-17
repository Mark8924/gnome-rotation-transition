#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$(id -u)" = 0 ]; then
    echo 'Run this as your desktop user, without sudo.' >&2
    exit 1
fi
command -v gnome-shell >/dev/null || { echo 'GNOME Shell is required.' >&2; exit 1; }
case "$(gnome-shell --version)" in
    'GNOME Shell 51'|'GNOME Shell 51.'*) ;;
    *) echo 'This preview supports GNOME Shell 51 only.' >&2; exit 1 ;;
esac
command -v python3 >/dev/null || { echo 'Python 3 is required to build the ZIP.' >&2; exit 1; }
command -v gnome-extensions >/dev/null || { echo 'gnome-extensions is required.' >&2; exit 1; }
python3 build.py
gnome-extensions install --force dist/nabu-rotation-transition@mipad5.local.shell-extension.zip
echo 'Installed. Save your work, log out and back in, then run:'
echo 'gnome-extensions enable nabu-rotation-transition@mipad5.local'
