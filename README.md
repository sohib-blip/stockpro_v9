# StockPro

Application interne de gestion de stock construite avec Next.js et Supabase.

StockPro couvre notamment les receptions fournisseurs, les IMEI, les cartons,
les emplacements, les sorties, les retours, les transferts, les accessoires,
les approvisionnements, les etiquettes Zebra et le suivi NRD.

## Environnements

| Environnement | Branche | Base de donnees |
| --- | --- | --- |
| Production | `main` | Supabase production |
| Test partage | `staging` | Supabase staging |
| Developpement | `feature/*` | Supabase staging |

Ne jamais utiliser les identifiants Supabase de production sur `staging` ou
sur une branche de fonctionnalite.

Le workflow complet de l'equipe se trouve dans
[`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md).

## Developpement local

1. Copier `.env.example` vers `.env.local`.
2. Renseigner uniquement les identifiants de l'environnement de test.
3. Installer et demarrer le projet :

```bash
npm ci
npm run dev
```

Avant d'ouvrir une pull request :

```bash
npm run check
```

Cette commande execute le typecheck, les tests automatises et le build de
production. GitHub execute egalement ces controles pour chaque pull request
vers `staging`.

La base de l'audit de securite se trouve dans
[`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md).

## Variables principales

- `NEXT_PUBLIC_APP_ENV` : `production`, `staging` ou `development`.
- `NEXT_PUBLIC_SUPABASE_URL` : URL Supabase de l'environnement.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` : cle publique Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` : cle serveur, jamais exposee au navigateur.
- `ENABLE_LOW_STOCK_EMAILS` : garder `false` hors production.
- `CRON_SECRET` : protege l'endpoint du cron Vercel.
- `RESEND_API_KEY` : necessaire uniquement pour les alertes e-mail autorisees.
