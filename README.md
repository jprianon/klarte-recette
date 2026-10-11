# Klarte Vie — Web

**Carnet de recettes** perso (Jérémy + sa copine, mêmes données). Note libre ou photo →
fiche structurée par l'**IA**, avec dossiers, planning des repas et liste de courses.

> Historique : le projet a démarré comme dashboard de pilotage de vie multi-onglets
> (Recettes, Trading, Sport, Today…) partageant le backend Supabase du mobile
> [`../klarte-vie`](../klarte-vie). Il a depuis **pivoté vers une app de recettes pure**
> (commit « Pivot vers app de recettes pure ») : plus de coque dashboard, plus de Supabase
> pour les données, stockage **Postgres auto-hébergé**. Le lien **Trading** ouvre l'app
> voisine [`../klarte-trade`](../klarte-trade) dans un nouvel onglet.

## Partage depuis Pinterest / l'iPhone

`POST /api/share` importe la recette d'un lien partagé (pins Pinterest suivis
jusqu'au site source), la met en fiche via l'IA et l'enregistre avec sa photo.
Sur iPhone, ça passe par un Raccourci iOS : voir [`docs/raccourci-ios.md`](docs/raccourci-ios.md).
Sur Android, la PWA apparaît directement dans le menu Partager (`share_target` → `/partage`).

## Contexte

- Framework : **Next.js 15** (App Router) + **React 19**, **TypeScript** strict.
- UI : **Tailwind** + shadcn (primitives `button`, `sonner`), thème vert forêt, police arrondie, dark mode.
- Data : **Postgres auto-hébergé** via `pg` (conteneur `db`) — schéma créé/migré à la volée
  au premier accès (`src/lib/db.ts`, aucune migration manuelle). Les clients Supabase
  subsistent mais **ne servent plus** aux recettes (réservés à un éventuel auth futur).
- IA : reformatage « note → recette » via provider interchangeable (`RECIPE_AI_PROVIDER`) —
  **Ollama** (LLM local sur le VPS, gratuit/privé) ou **API Claude**.
- Forms/validation : **react-hook-form** + **zod**. State : **zustand**.
- Accès : **code partagé unique** (sans comptes), garde par middleware.
- **PWA** (installable, raccourci « Recettes »).

## Architecture

```
src/
├─ app/
│   ├─ layout.tsx            · racine (thème, fonte, toaster, enregistrement PWA)
│   ├─ page.tsx              · redirige vers /recettes
│   ├─ recettes/page.tsx     · écran unique (nav basse : recettes / dossiers / planning / courses)
│   ├─ acces/page.tsx        · saisie du code d'accès partagé
│   └─ api/
│       ├─ recipes/          · CRUD + [id] + [id]/image + [id]/folders
│       ├─ recipes/format    · note → fiche JSON (validée zod) via l'IA
│       ├─ recipes/ocr       · photo → texte (Tesseract) → fiche IA
│       ├─ folders/          · dossiers (collections) + [id]/recipes
│       ├─ plan/             · planning des repas
│       ├─ shopping/         · liste de courses
│       └─ acces/            · pose le cookie d'accès
├─ features/recipes/
│   ├─ ai-provider.ts        · dispatch Ollama / Claude (même schéma de sortie)
│   ├─ format.ts             · prompt système + schéma JSON + validation zod
│   ├─ service.ts, gradient.ts, mock.ts
│   └─ components/           · vues (recipes/folders/planning/shopping), form, détail, OCR, etc.
├─ lib/db.ts                 · pool pg + schéma auto-migré + toutes les requêtes
├─ lib/supabase/             · clients résiduels (non utilisés par les recettes)
├─ middleware.ts             · garde du code d'accès partagé
└─ types/                    · types métier (+ database.types.ts Supabase, résiduel)
```

**Tables Postgres** (créées à la volée) : `recipes`, `recipe_images` (photo en `bytea`),
`folders` + `folder_recipes`, `shopping_items`, `meal_plan`.

## Prérequis

- Node ≥ 20, **pnpm** 10.
- **Dév local** : un Postgres accessible (`DATABASE_URL`). L'app tourne sans base — l'écran
  Recettes reste consultable en mock, mais l'enregistrement échoue.
- **OCR** (route `/api/recipes/ocr`) : binaire **`tesseract`** installé (langue `fra`) — présent
  dans l'image Docker, à installer soi-même en dév local si besoin.
- **IA** : soit `ANTHROPIC_API_KEY` (Claude), soit un **Ollama** joignable (`OLLAMA_URL`, modèle 3B).

## Installation (dév)

```bash
pnpm install
cp .env.local.example .env.local   # renseigner DATABASE_URL + provider IA
pnpm dev                           # http://localhost:3031  → /recettes
```

## Variables d'environnement

Voir [`.env.example`](.env.example) (production Docker) et `.env.local.example` (dév).

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion Postgres (host `db` en Docker). **Seule** source des recettes. |
| `POSTGRES_PASSWORD` | Mot de passe du conteneur `db` (doit matcher `DATABASE_URL`). |
| `ACCESS_CODE` | Code d'accès partagé. **Vide = app ouverte** (aucune protection). Runtime (pas de rebuild). |
| `RECIPE_AI_PROVIDER` | `ollama` \| `claude` \| vide (Claude si clé présente, sinon reformatage désactivé). |
| `ANTHROPIC_API_KEY` | Clé Claude si provider = `claude` (**serveur uniquement**). |
| `OLLAMA_URL` / `RECIPE_AI_MODEL` | Endpoint Ollama + modèle (déf. `qwen2.5:3b`) si provider = `ollama`. |
| `NEXT_PUBLIC_TRADE_URL` | Lien « Trading » → app klarte-trade (**inlinée au build**). |
| `NEXT_PUBLIC_SITE_URL` | URL publique de l'app. |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | **Optionnels/résiduels** — plus utilisés par les recettes. |

## Déploiement

VPS dockerisé derrière Nginx, en sous-domaines (`vie.klarte.re` / `trade.klarte.re`).
Voir [`DEPLOY.md`](DEPLOY.md), [`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml)
et les vhosts [`deploy/`](deploy/). Ollama est un service Docker optionnel (profil `ollama`).

```bash
cp .env.example .env               # remplir DATABASE_URL, ACCESS_CODE, provider IA…
docker compose up -d --build
```

## État d'avancement

Livré (app de recettes fonctionnelle, déployable) :

- [x] **Recettes CRUD** — fiche détaillée (temps prépa/repos/cuisson, portions, difficulté,
      nutrition kcal/glucides/protéines/lipides), tags, notation étoiles, favoris, photos (`bytea`).
- [x] **Reformatage IA** — note libre → fiche structurée (`/api/recipes/format`), provider
      Ollama **ou** Claude, même schéma de sortie.
- [x] **Import photo** — OCR Tesseract (`/api/recipes/ocr`) → texte → fiche IA.
- [x] **Dossiers** (collections), **Planning** des repas, **Liste de courses**, navigation basse.
- [x] **Accès** — code partagé unique (middleware), sans comptes.
- [x] **PWA** + **déploiement Docker** (Nginx, sous-domaines, lien vers klarte-trade).

Pistes ouvertes :

- [ ] Auth réelle (Supabase) si multi-utilisateurs un jour — le socle client subsiste.
- [ ] Tests automatisés (aucun pour l'instant).

## Dépannage

- **`pnpm lint` / build : « Cannot find module … »** — fichiers `node_modules` non matérialisés
  par OneDrive. Corrigé par `pnpm install --force`. Éviter les installs pnpm pendant une
  synchro OneDrive active.
- **OCR « indisponible »** — binaire `tesseract` absent (présent dans l'image Docker seulement).
- **IA en 503** — `RECIPE_AI_PROVIDER` non configuré, ou Ollama/le modèle pas prêt : l'UI
  bascule alors en saisie manuelle.
- **Bruit git (fins de ligne)** — OneDrive réécrit les fichiers ; `.gitattributes` force `eol=lf`
  pour éviter les « modifications » LF↔CRLF fantômes.
