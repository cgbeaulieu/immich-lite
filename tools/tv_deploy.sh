#!/bin/sh
# Installs dist/com.cgbeaulieu.immichlite_<version>_all.ipk on a rooted webOS TV over SSH,
# stops the old service (webOS keeps running it after an install, so new service code
# would not load) and relaunches the app. Build the IPK first:
#   npx -y -p @webos-tools/cli ares-package app service -o dist
# Usage: TV=root@192.168.1.50 TV_KEY=~/webos_key sh tools/tv_deploy.sh dist/<file>.ipk
# (luna-send -n 1 prints nothing on webOS 3, hence the -w ... & sleep; kill pattern.)
set -e
: "${TV:?set TV=root@<tv address>}"
IPK="${1:?give the .ipk path}"
SSH="ssh -o ConnectTimeout=8 -o BatchMode=yes -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa ${TV_KEY:+-i $TV_KEY} $TV"
$SSH "cat > /tmp/immichlite.ipk" < "$IPK"
$SSH "sh -s" <<'EOF'
ls() { luna-send -w "$1" -i "$2" "$3" > /tmp/il-ls.log 2>&1 & p=$!; sleep "$4"; kill $p 2>/dev/null; tail -1 /tmp/il-ls.log; }
ls 4000 luna://com.webos.applicationManager/closeByAppId '{"id":"com.cgbeaulieu.immichlite"}' 3
ls 30000 luna://com.webos.appInstallService/dev/install '{"id":"com.cgbeaulieu.immichlite","ipkUrl":"/tmp/immichlite.ipk","subscribe":true}' 18
for pid in $(ps -ef 2>/dev/null | grep -i "immichlite.service" | grep -v grep | awk '{print $2}'); do kill $pid && echo "stopped old service $pid"; done
sleep 2
ls 8000 luna://com.webos.applicationManager/launch '{"id":"com.cgbeaulieu.immichlite"}' 8
netstat -ltn 2>/dev/null | grep 879
EOF
