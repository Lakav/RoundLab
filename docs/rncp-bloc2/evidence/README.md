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

## Sources du référentiel

- [France compétences — RNCP39583BC02](https://www.francecompetences.fr/recherche/rncp/39583)
- [RGAA 4.1.2 — DINUM](https://accessibilite.numerique.gouv.fr/)
- [OWASP Top 10:2025](https://owasp.org/Top10/)
