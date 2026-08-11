# Workflow de developpement StockPro

## Regles

- `main` correspond toujours a l'application de production.
- `staging` correspond a l'application de test partagee.
- Une modification commence dans une branche `feature/<sujet>` ou
  `fix/<sujet>` creee depuis `staging`.
- Aucun push direct ne doit etre autorise sur `main`.
- Une modification atteint `main` uniquement apres validation sur staging.
- Les donnees de test doivent etre fictives ou anonymisees.

## Commencer une modification

```bash
git switch staging
git pull origin staging
git switch -c feature/nom-court
```

Apres le developpement :

```bash
npm run check
git add <fichiers>
git commit -m "Description claire"
git push -u origin feature/nom-court
```

Ouvrir ensuite une pull request vers `staging`. Vercel fournit une URL de
preview permettant de verifier exactement cette modification.

## Publier en production

1. Tester la version la plus recente de `staging` avec des donnees fictives.
2. Verifier les parcours Inbound, Outbound, Return et Transfer concernes.
3. Ouvrir une pull request de `staging` vers `main`.
4. Faire approuver la pull request par au moins une autre personne.
5. Fusionner seulement lorsque les controles automatiques reussissent.

## Variables Vercel

### Production (`main`)

- `NEXT_PUBLIC_APP_ENV=production`
- Identifiants du projet Supabase de production
- `ENABLE_LOW_STOCK_EMAILS=true`
- `CRON_SECRET` defini
- `RESEND_API_KEY` defini

### Preview et staging

- `NEXT_PUBLIC_APP_ENV=staging`
- Identifiants du projet ou de la branche Supabase de test
- `ENABLE_LOW_STOCK_EMAILS=false`
- Une valeur de test distincte pour `CRON_SECRET`
- Ne pas fournir la cle Resend de production

## Verification visuelle

La version staging affiche une banniere bleue en haut de chaque page. Si cette
banniere n'est pas visible sur l'URL de test, verifier
`NEXT_PUBLIC_APP_ENV` avant de manipuler des donnees.

## Base de donnees

Toute modification de schema doit etre enregistree dans une migration Supabase
versionnee. La base de staging doit recevoir la migration avant la production.
Le jeu de donnees de staging ne doit contenir ni IMEI reels, ni adresses e-mail
reelles, ni informations confidentielles copiees de la production.
