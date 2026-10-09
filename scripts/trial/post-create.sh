#!/usr/bin/env bash
# Runs once when the Codespace is created (.devcontainer/devcontainer.json postCreateCommand): PostgreSQL 17 + pgvector
# from the PostgreSQL project's apt repository, the local postgres password, and the npm packages.
set -euo pipefail
cd "$(dirname "$0")/../.."
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-17 postgresql-17-pgvector >/dev/null
sudo pg_ctlcluster 17 main start || sudo service postgresql start
sudo -u postgres psql -qc "ALTER USER postgres PASSWORD 'postgres'"
npm ci --no-audit --no-fund
echo "[trial] Codespace prepared: PostgreSQL 17 + pgvector, packages installed."
