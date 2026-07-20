# Sécurité - OWASP Top 10:2025

Référentiel retenu : **OWASP Top 10:2025**. RoundLab est un site statique sans compte, API métier ni serveur applicatif. `N/A` signifie que la catégorie ne s'applique pas à cette architecture, pas qu'elle a été ignorée.

| Catégorie | Mesures et preuves | Risque résiduel | État |
| --- | --- | --- | --- |
| A01 Broken Access Control | aucune identité ni ressource distante ; données limitées au profil navigateur | une personne utilisant le même profil peut lire IndexedDB | N/A serveur |
| A02 Security Misconfiguration | CSP, `no-referrer`, aucune route serveur, permissions CI minimales | `unsafe-inline` reste nécessaire à l'export Next actuel | Partiel |
| A03 Software Supply Chain Failures | lockfiles, installation gelée, politique de scripts pnpm, audits npm/RustSec | deux warnings RustSec sans version corrigée | Couvert avec suivi |
| A04 Cryptographic Failures | aucune démo uploadée, aucun secret applicatif | IndexedDB n'est pas chiffré par RoundLab | Partiel documenté |
| A05 Injection | échappement React ; audit sans `innerHTML`, `eval`, `new Function` ni sink HTML applicatif | une faille d'une dépendance reste possible | Couvert par code et audit |
| A06 Insecure Design | Worker, limites 1 Gio, validation avant stockage et lecture | une entrée hostile sous la limite peut rester coûteuse | Partiel |
| A07 Authentication Failures | aucune authentification | ajout futur d'un compte changerait l'analyse | N/A actuel |
| A08 Software or Data Integrity Failures | WASM 0.2.126 reconstruit deux fois, artefact Linux canonique et comparaison Git en CI | IndexedDB reste modifiable par l'utilisateur local | Couvert partiellement |
| A09 Security Logging and Alerting Failures | erreurs locales, logs de CI, absence de stack affichée à l'utilisateur | aucune supervision distante par choix local-first | Partiel assumé |
| A10 Mishandling of Exceptional Conditions | annulation, erreurs typées, transactions, limites zstd, tests de corruption | cas réels non couverts par fixture possibles | Couvert par tests ciblés |

## Audits de dépendances

- npm/pnpm : **0 info, 0 low, 0 moderate, 0 high, 0 critical** après Next 16.2.10, PostCSS 8.5.10 et js-yaml corrigé par résolution normale du lockfile.
- RustSec : aucune vulnérabilité bloquante. Deux warnings `unsound` restent sans version corrigée au contrôle : `RUSTSEC-2026-0190` pour `anyhow 1.0.102` et `RUSTSEC-2026-0186` pour `memmap2 0.9.10`.
- Les warnings Rust ne sont ni exclus ni présentés comme corrigés.

## Confidentialité

Les fichiers GOTV sont lus avec File API, transférés à un Web Worker, parsés en WASM puis stockés dans IndexedDB. Aucune route d'upload n'existe. Cette confidentialité dépend toutefois du poste, du profil navigateur, des extensions installées et de la politique de sauvegarde locale ; RoundLab n'ajoute pas de chiffrement au repos.
