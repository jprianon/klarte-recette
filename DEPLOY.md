# Déploiement VPS — Klarte Vie Web + Klartè Trade

Deux conteneurs Docker **indépendants** derrière le **Nginx** de l'hôte, en **deux sous-domaines**.
Le clic sur **Trading** (rail de klarte-vie-web) ouvre klarte-trade dans un **nouvel onglet**.

```
                    ┌───────────────── VPS ─────────────────┐
  vie.klarte.re │  Nginx :80/:443                        │
  ───────────────►  │   ├─ vie.…   → 127.0.0.1:3031  (vie-web, conteneur)
  trade.klarte.re│   └─ trade.… → 127.0.0.1:3002  (trade,  conteneur)
  ───────────────►  └───────────────────────────────────────┘
```

## Prérequis
- Docker + Docker Compose plugin installés.
- Nginx installé, certbot (`python3-certbot-nginx`).
- DNS : `vie` et `trade` (enregistrements A/AAAA) pointant vers l'IP du VPS.

---

## 1. Klartè Trade (déjà dockerisé)

Dans `klarte-trade/` :

```bash
cp .env.example .env      # renseigner CTRADER_* et PORT=3002
docker compose up -d --build
```

> **Sécurité** : pour n'exposer le port qu'à Nginx, dans `klarte-trade/docker-compose.yml`
> remplacer `- "3002:3002"` par `- "127.0.0.1:3002:3002"`.

> **OAuth cTrader** : l'URL de redirection déclarée sur openapi.ctrader.com doit correspondre
> au sous-domaine public (`https://trade.klarte.re/...`), pas à `localhost`.

## 2. Klarte Vie Web

Dans `klarte-vie-web/` :

```bash
cp .env.example .env      # NEXT_PUBLIC_TRADE_URL=https://trade.klarte.re + Supabase + ANTHROPIC_API_KEY
docker compose up -d --build
```

> `NEXT_PUBLIC_TRADE_URL` est **inlinée au build** (variable publique Next). Si tu changes le
> sous-domaine trade plus tard, il faut **rebuild** (`docker compose up -d --build`), pas juste restart.

## 3. Nginx + HTTPS

```bash
# Copier les vhosts (adapter le domaine dans les 2 fichiers deploy/nginx-*.conf)
sudo cp deploy/nginx-vie.conf   /etc/nginx/sites-available/vie.klarte.re
sudo cp deploy/nginx-trade.conf /etc/nginx/sites-available/trade.klarte.re
sudo ln -s /etc/nginx/sites-available/vie.klarte.re   /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/trade.klarte.re /etc/nginx/sites-enabled/

sudo nginx -t && sudo systemctl reload nginx

# HTTPS (Let's Encrypt) — certbot ajoute automatiquement les blocs 443 + redirection.
sudo certbot --nginx -d vie.klarte.re -d trade.klarte.re
```

## 4. Vérification

- `https://vie.klarte.re` → dashboard (écran Recettes).
- Clic **Trading** → nouvel onglet `https://trade.klarte.re`.

## Mises à jour

### Automatique (GitHub Actions)

Chaque push sur `main` déclenche `.github/workflows/deploy.yml` : connexion SSH en tant que
`deploy`, `git reset --hard origin/main`, rebuild du seul service `app` (la base n'est pas
touchée), puis vérification que `127.0.0.1:3031` répond.

Mise en place, une seule fois, sur le VPS :

```bash
cd /chemin/vers/klarte-recette && git pull
sudo bash deploy/setup-gha-deploy.sh "$(pwd)"
```

Le script crée l'utilisateur `deploy`, sa clé SSH et les secrets `VPS_HOST`, `VPS_PORT`,
`VPS_USER`, `VPS_APP_DIR`, `VPS_SSH_KEY` (via `gh` s'il est connecté, sinon il les affiche
pour les coller dans Settings → Secrets → Actions). Relance possible depuis l'onglet
Actions → Deploy VPS → Run workflow.

### Manuelle

```bash
git pull
docker compose up -d --build     # dans chaque dossier concerné
```

---

## Domaines
Configurés sur **`vie.klarte.re`** (vie-web) et **`trade.klarte.re`** (trade) dans les
vhosts Nginx, le `.env` (`NEXT_PUBLIC_TRADE_URL`, `NEXT_PUBLIC_SITE_URL`) et les commandes certbot.
