#!/usr/bin/env bash
# Prépare le VPS pour le déploiement GitHub Actions et crée les secrets du repo.
#
# Usage (sur le VPS, en root) :
#   sudo bash deploy/setup-gha-deploy.sh /chemin/vers/klarte-recette
#
# Ce que fait le script :
#   1. crée l'utilisateur "deploy" (sans sudo), membre du groupe docker
#   2. lui donne la propriété du dossier de l'app (le .env reste en 600)
#   3. génère la clé SSH utilisée par GitHub Actions et l'autorise
#   4. crée les secrets VPS_* via gh si dispo, sinon les affiche à copier
set -euo pipefail

REPO="jprianon/klarte-recette"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${1:?Usage: sudo bash $0 /chemin/vers/klarte-recette}"
APP_DIR="$(realpath "$APP_DIR")"

[[ $EUID -eq 0 ]] || { echo "✗ À lancer en root (sudo)."; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "✗ $APP_DIR n'est pas un clone git."; exit 1; }
[[ -f "$APP_DIR/docker-compose.yml" ]] || { echo "✗ docker-compose.yml absent de $APP_DIR."; exit 1; }

# 1. Utilisateur deploy
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"

# 2. Dossier de l'app
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
[[ -f "$APP_DIR/.env" ]] && chmod 600 "$APP_DIR/.env"
# Repo public : pull en HTTPS, aucune clé GitHub nécessaire côté VPS.
git -C "$APP_DIR" remote set-url origin "https://github.com/$REPO.git"

# 3. Clé SSH GitHub Actions -> VPS
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
KEY="$DEPLOY_HOME/.ssh/gha_deploy"
if [[ ! -f "$KEY" ]]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -q -t ed25519 -N "" -C "github-actions@klarte-recette" -f "$KEY"
fi
AUTH="$DEPLOY_HOME/.ssh/authorized_keys"
touch "$AUTH"
grep -qxF "$(cat "$KEY.pub")" "$AUTH" || cat "$KEY.pub" >> "$AUTH"
chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
chmod 600 "$AUTH"

# Vérif rapide : deploy peut piloter le compose
if sudo -u "$DEPLOY_USER" docker compose --project-directory "$APP_DIR" ps >/dev/null 2>&1; then
  echo "✓ deploy a accès à Docker"
else
  echo "⚠ deploy n'arrive pas à lancer 'docker compose ps' : vérifie le groupe docker."
fi

# Paramètres de connexion
PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
PORT="${PORT:-22}"
HOST="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"

if sshd -T 2>/dev/null | grep -qE '^(allowusers|allowgroups) '; then
  echo "⚠ sshd a une directive AllowUsers/AllowGroups : ajoute-y '$DEPLOY_USER', puis 'systemctl reload ssh'."
fi

# 4. Secrets GitHub
declare -A SECRETS=(
  [VPS_HOST]="$HOST"
  [VPS_PORT]="$PORT"
  [VPS_USER]="$DEPLOY_USER"
  [VPS_APP_DIR]="$APP_DIR"
)

if command -v gh >/dev/null && gh auth status &>/dev/null; then
  for name in "${!SECRETS[@]}"; do
    gh secret set "$name" -R "$REPO" --body "${SECRETS[$name]}"
  done
  gh secret set VPS_SSH_KEY -R "$REPO" < "$KEY"
  echo "✓ 5 secrets créés sur $REPO"
else
  echo
  echo "gh non installé/connecté : crée ces secrets à la main dans"
  echo "https://github.com/$REPO/settings/secrets/actions"
  echo
  for name in "${!SECRETS[@]}"; do
    printf '  %-12s %s\n' "$name" "${SECRETS[$name]}"
  done
  echo
  echo "  VPS_SSH_KEY  (tout le bloc ci-dessous, lignes BEGIN/END comprises) :"
  cat "$KEY"
fi

echo
echo "Terminé. Vérifie que VPS_HOST ($HOST) est bien l'IP publique du VPS."
