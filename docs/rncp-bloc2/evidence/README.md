# Preuves RNCP Bloc 2 — RoundLab

Ce dossier rassemble les preuves techniques du bloc `RNCP39583BC02 — Concevoir et développer des applications logicielles`. Une preuve n’est déclarée acquise que si le code ou un rapport d’exécution la démontre. Les contrôles non exécutés sont marqués `BLOQUÉ`.

## Index

- `01-matrice-rncp.md` : traçabilité entre compétences, réalisations et preuves.
- `02-architecture.md` : architecture, flux locaux et frontières de confiance.
- `03-plan-tests-recette.md` : stratégie de tests et cahier de recette.
- `04-securite-owasp.md` : analyse OWASP Top 10:2025 et mesures appliquées.
- `05-accessibilite-rgaa.md` : référentiel retenu, améliorations et limites.
- `06-exploitation.md` : installation, construction, mise à jour et utilisation.
- `07-qualite-performance.md` : critères mesurables et périmètres de couverture.
- `08-anomalies-corrections.md` : anomalies observées et corrections vérifiées.
- `09-historique-versions.md` : stratégie de version et historique factuel.
- `10-smoke-browser.md` : vérification DOM/interactions de l’export servi localement.
- `11-validation-utilisateur.md` : protocole de 8 tâches et grilles vierges ; sessions réelles encore bloquées.
- `deployment-runs-2026-07-20.md` : CI, déploiement, rollback et restauration réellement observés pour v0.1.39.
- `deployment-runs-2026-07-21.md` : CI de PR et `main`, déploiement, smokes, rollback et restauration réellement observés pour v0.1.40.
- `fixture-search-2026-07-21.json` : recherche locale initiale bornée des cinq cartes alors sans fixture, sans candidat trouvé.
- `fixture-acquisition-2026-07-21.json` : provenance, empreintes et résultats vérifiés des cinq démos CS2 publiques ajoutant Mirage, Nuke, Overpass, Train et Vertigo.
- `logs/replay-fixtures-public.txt` : commandes et sorties factuelles de parsing `full`, d'audit de rendu et de contrôle du manifeste local.
- `performance/` : protocoles et résultats natifs/navigateur, chacun sur 3 démos × 3 répétitions, résumés machine et rapports dédiés.
- `recipe-summary.json` : décompte machine des statuts du cahier de recette.
- `execution-tests.md` : synthèse générée des contrôles réellement exécutés.
- `environment.txt` : versions d’outils, commit de base et état non commité contrôlé.
- `logs/` : sorties brutes avec commande et code de retour.
- `coverage/` : rapports machine frontend et Rust.

## Régénération

Depuis la racine :

```bash
python3 scripts/collect-rncp-bloc2-evidence.py --demo demos/dust1-13.dem.zst
```

La démo est une fixture locale ignorée par Git. Sans `--demo`, le contrôle de fidélité réel est marqué `BLOQUÉ`.

Le benchmark navigateur complet utilise des fichiers locaux ignorés par Git et reste donc opt-in. Sa commande exacte et ses seuils sont dans `performance/benchmark-protocol-and-results.md`. `python3 scripts/summarize-browser-benchmark.py` valide ensuite que les 9 résultats conservés sont complets et sous les budgets.

## Sources du référentiel

- [France compétences — RNCP39583BC02](https://www.francecompetences.fr/recherche/rncp/39583)
- [RGAA 4.1.2 — DINUM](https://accessibilite.numerique.gouv.fr/)
- [OWASP Top 10:2025](https://owasp.org/Top10/)
