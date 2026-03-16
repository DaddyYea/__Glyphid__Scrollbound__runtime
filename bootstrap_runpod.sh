#!/usr/bin/env bash
set -euo pipefail

echo "==> Refreshing apt"
apt-get update

echo "==> Ensuring base tools"
apt-get install -y curl ca-certificates gnupg

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\.'; then
  echo "==> Installing Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
else
  echo "==> Node already present: $(node -v)"
fi

if ! python3 -m pip show vllm >/dev/null 2>&1; then
  echo "==> Installing vLLM"
  python3 -m pip install vllm
else
  echo "==> vLLM already present"
fi

echo "==> Done"
echo "node: $(node -v)"
echo "npm: $(npm -v)"
python3 -m pip show vllm | sed -n '1,3p'
