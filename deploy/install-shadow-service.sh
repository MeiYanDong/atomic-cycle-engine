#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "install-shadow-service.sh must run as root" >&2
  exit 1
fi

release_dir=${1:-/opt/atomic-cycle-engine/current}
if [[ ! -f ${release_dir}/dist/src/cli/cross-venue-shadow.js ]]; then
  echo "built cross-venue shadow entrypoint not found in release" >&2
  exit 1
fi

service_user=atomic-cycle-shadow
service_group=atomic-cycle-shadow
state_dir=/var/lib/atomic-cycle-shadow
unit_source=${release_dir}/deploy/systemd/atomic-cycle-shadow.service
unit_target=/etc/systemd/system/atomic-cycle-shadow.service

getent group "${service_group}" >/dev/null || groupadd --system "${service_group}"
id "${service_user}" >/dev/null 2>&1 || useradd \
  --system \
  --gid "${service_group}" \
  --home-dir "${state_dir}" \
  --shell /usr/sbin/nologin \
  "${service_user}"
install -d -o "${service_user}" -g "${service_group}" -m 0755 "${state_dir}"
install -o root -g root -m 0644 "${unit_source}" "${unit_target}"

systemd-analyze verify "${unit_target}"
systemctl daemon-reload
systemctl enable --now atomic-cycle-shadow.service

ready=0
for attempt in {1..12}; do
  if [[ -s ${state_dir}/public.json ]] && node -e '
    const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    if (value.mode !== "READ_ONLY_CROSS_VENUE_SHADOW") process.exit(1);
    if (value.signingEnabled !== false || value.broadcastEnabled !== false) process.exit(1);
    if (!Array.isArray(value.networks) || value.networks.length !== 2) process.exit(1);
  ' "${state_dir}/public.json"; then
    ready=1
    break
  fi
  sleep 10
done

if ((ready != 1)); then
  systemctl status atomic-cycle-shadow.service --no-pager || true
  echo "shadow service did not publish a valid snapshot" >&2
  exit 1
fi

if [[ $(stat -c '%a' "${state_dir}") != 755 || $(stat -c '%a' "${state_dir}/public.json") != 644 ]]; then
  echo "shadow public read model has unexpected permissions" >&2
  exit 1
fi
