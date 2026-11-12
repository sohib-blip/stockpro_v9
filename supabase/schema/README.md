# Instantane du schema de base

`staging-schema.sql` decrit la structure complete actuelle de la base de
staging : tables, colonnes, contraintes, index, fonctions et RPC, vues,
triggers, securite par ligne (RLS) et politiques, droits des roles `anon`,
`authenticated` et `service_role`, droits par defaut, commentaires.

Il ne contient aucune donnee. Il couvre les schemas `public` et `private`; les
schemas geres par Supabase (`auth`, `storage`, `realtime`, `vault`,
`extensions`, `graphql`) n'y sont pas.

## Pourquoi

Les fichiers de `supabase/migrations` ne decrivent que les changements faits
depuis le 16/07/2026. Une partie de la base existait avant (notamment `items`,
`bins`, `boxes`, `movements`, `devices`, `profiles`, `user_roles`,
`user_permissions`, les vues du tableau de bord) et n'est decrite dans aucune
migration. Ce fichier permet :

- de recreer un environnement vide avec la meme structure ;
- de reperer les ecarts : en regenerant le fichier, `git diff` montre ce qui a
  change dans la base depuis la derniere fois.

## Regenerer

Apres chaque migration appliquee sur staging :

```bash
npm run db:schema
```

puis commiter `supabase/schema/staging-schema.sql` avec la migration.

- La commande lit staging en lecture seule (`supabase db query --read-only`)
  avec la connexion Supabase CLI de la personne qui la lance (`npx supabase
  login`). Elle n'ecrit rien dans la base.
- La requete lue est `scripts/sql/schema-snapshot.sql`; la mise en forme est
  dans `scripts/lib/schema-snapshot.mjs`.
- L'ordre des instructions est stable : deux generations sur une base
  inchangee donnent le meme fichier (seule la date de l'en-tete change).

Production : uniquement avec l'accord explicite de la personne responsable de
l'application, en lecture seule, et jamais dans le depot :
`npm run db:schema -- --production --out /chemin/hors/du/depot.sql`.

## Verifications automatiques

- `tests/unit/schemaSnapshot.test.ts` echoue si une migration plus recente que
  celle indiquee dans l'en-tete (`Last migration reflected`) est ajoutee sans
  regenerer le fichier.
- `tests/unit/schemaSnapshotLoads.test.ts` charge le fichier dans un Postgres 17
  vide en memoire (PGlite, sans reseau) puis le relit : il echoue si le fichier
  ne permet plus de reconstruire une base ou s'il a ete modifie a la main.

## Recreer une base

Sur un projet Supabase neuf, executer le fichier dans l'editeur SQL (ou avec
`npx supabase db query --remote=<ref> -f supabase/schema/staging-schema.sql`).
Le chargement est verifie automatiquement sur un Postgres vide, pas encore sur
un vrai projet Supabase.
Les migrations deja refletees dans le fichier ne doivent pas etre rejouees
ensuite. Les donnees de reference (roles, permissions, catalogues) ne sont pas
incluses.
