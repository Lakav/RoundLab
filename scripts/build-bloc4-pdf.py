#!/usr/bin/env python3
"""Build the jury-ready RoundLab Bloc 4 PDF with ReportLab."""

from __future__ import annotations

import argparse
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "dossier-bloc-4-roundlab.pdf"
FONT_REGULAR = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")

INK = colors.HexColor("#15201C")
MUTED = colors.HexColor("#5F6E67")
GREEN = colors.HexColor("#147D58")
GREEN_LIGHT = colors.HexColor("#E8F5EF")
AMBER = colors.HexColor("#B76710")
AMBER_LIGHT = colors.HexColor("#FFF3DF")
RED = colors.HexColor("#A83B35")
RED_LIGHT = colors.HexColor("#FCEAE8")
LINE = colors.HexColor("#D6E0DB")
PAPER = colors.HexColor("#F7FAF8")


def register_fonts() -> tuple[str, str]:
    if FONT_REGULAR.exists() and FONT_BOLD.exists():
        pdfmetrics.registerFont(TTFont("RoundLab", str(FONT_REGULAR)))
        pdfmetrics.registerFont(TTFont("RoundLab-Bold", str(FONT_BOLD)))
        return "RoundLab", "RoundLab-Bold"
    return "Helvetica", "Helvetica-Bold"


REGULAR, BOLD = register_fonts()


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "cover_kicker",
            parent=base["Normal"],
            fontName=BOLD,
            fontSize=10,
            leading=13,
            textColor=GREEN,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName=BOLD,
            fontSize=29,
            leading=33,
            textColor=INK,
            alignment=TA_CENTER,
            spaceAfter=14,
        ),
        "cover_subtitle": ParagraphStyle(
            "cover_subtitle",
            parent=base["Normal"],
            fontName=REGULAR,
            fontSize=12,
            leading=17,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName=BOLD,
            fontSize=18,
            leading=22,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName=BOLD,
            fontSize=12.5,
            leading=16,
            textColor=GREEN,
            spaceBefore=9,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName=REGULAR,
            fontSize=9.2,
            leading=13.2,
            textColor=INK,
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName=REGULAR,
            fontSize=7.7,
            leading=10.2,
            textColor=INK,
        ),
        "small_bold": ParagraphStyle(
            "small_bold",
            parent=base["BodyText"],
            fontName=BOLD,
            fontSize=7.7,
            leading=10.2,
            textColor=INK,
        ),
        "callout": ParagraphStyle(
            "callout",
            parent=base["BodyText"],
            fontName=REGULAR,
            fontSize=9,
            leading=13,
            textColor=INK,
            leftIndent=4 * mm,
            rightIndent=4 * mm,
            spaceBefore=4,
            spaceAfter=4,
        ),
    }


S = styles()


def P(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, S[style])


def bullet(text: str) -> Paragraph:
    return P(f"- {text}")


def table(
    rows: list[list[str]],
    widths: list[float],
    *,
    header: bool = True,
    font_size: float = 7.4,
) -> Table:
    data = []
    for row_index, row in enumerate(rows):
        style_name = "small_bold" if header and row_index == 0 else "small"
        data.append([P(cell, style_name) for cell in row])
    result = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("FONTNAME", (0, 0), (-1, -1), REGULAR),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
    ]
    if header:
        commands.extend(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ]
        )
    for row_index in range(1 if header else 0, len(rows)):
        if row_index % 2 == 0:
            commands.append(("BACKGROUND", (0, row_index), (-1, row_index), PAPER))
    result.setStyle(TableStyle(commands))
    return result


def callout(text: str, *, tone: str = "green") -> Table:
    palette = {
        "green": (GREEN_LIGHT, GREEN),
        "amber": (AMBER_LIGHT, AMBER),
        "red": (RED_LIGHT, RED),
    }
    background, border = palette[tone]
    box = Table([[P(text, "callout")]], colWidths=[174 * mm])
    box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), background),
                ("BOX", (0, 0), (-1, -1), 0.8, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return box


def draw_page(canvas, doc) -> None:
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, A4[1] - 14 * mm, A4[0] - 18 * mm, A4[1] - 14 * mm)
        canvas.setFont(BOLD, 7.5)
        canvas.setFillColor(GREEN)
        canvas.drawString(18 * mm, A4[1] - 10.8 * mm, "ROUNDLAB - BLOC 4")
        canvas.setFont(REGULAR, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 10.8 * mm, "Maintenance operationnelle")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
    canvas.setFont(REGULAR, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 8.8 * mm, "Version candidate 0.1.41 - 3 aout 2026")
    canvas.drawRightString(A4[0] - 18 * mm, 8.8 * mm, f"Page {page}")
    canvas.restoreState()


def build_story() -> list[object]:
    story: list[object] = []

    story.extend(
        [
            Spacer(1, 34 * mm),
            P("EXPERT EN DEVELOPPEMENT LOGICIEL - RNCP 39583", "cover_kicker"),
            P("Bloc 4", "cover_title"),
            P("Maintenir l'application logicielle<br/>en condition operationnelle", "cover_title"),
            Spacer(1, 9 * mm),
            P("Dossier de preuves - RoundLab", "cover_subtitle"),
            P("Application web d'analyse de demos Counter-Strike 2", "cover_subtitle"),
            Spacer(1, 18 * mm),
            table(
                [
                    ["Champ", "Valeur"],
                    ["Candidat", "A completer"],
                    ["Branche", "codex/bloc-4-maintenance-operationnelle"],
                    ["Version candidate", "0.1.41"],
                    ["Date", "3 aout 2026"],
                    ["Application", "https://lakav.github.io/RoundLab/"],
                ],
                [48 * mm, 126 * mm],
            ),
            Spacer(1, 18 * mm),
            callout(
                "Principe du dossier : chaque affirmation est reliee a une preuve technique. "
                "Les automatisations non encore fusionnees sont marquees comme pretes sur la branche. "
                "Aucun echange client ou support n'est invente.",
                tone="amber",
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("1. Synthese executive", "h1"),
            P(
                "RoundLab est un site statique Next.js deploye sur GitHub Pages. Le parseur Rust compile "
                "en WebAssembly traite les fichiers GOTV localement dans le navigateur. La maintenance "
                "porte donc sur le frontend, le parseur, les donnees statiques, les dependances, la CI et "
                "la disponibilite des artefacts publies."
            ),
            P(
                "Le depot possedait deja une CI exigeante, des audits de securite, des tests de non-regression "
                "et plusieurs correctifs reels. La branche Bloc 4 ajoute les pieces manquantes : Dependabot, "
                "un manifeste de deploiement, une sonde planifiee, des alertes par issue, un formulaire de bug, "
                "un changelog et des fiches de preuve."
            ),
            table(
                [
                    ["Competence", "Couverture", "Preuve principale", "Reste a obtenir"],
                    ["C4.1.1", "Prete sur la branche", "Dependabot + audits npm/Cargo", "Premieres PR periodiques"],
                    ["C4.1.2", "Prete sur la branche", "Sonde, manifeste, WASM, incident", "Runs distants apres fusion"],
                    ["C4.2.1", "Outillage complet", "Feedback, issue form, registre", "Issue utilisateur reelle"],
                    ["C4.2.2", "Demontree", "Correctifs, tests, CI, deploiement", "Livraison de 0.1.41"],
                    ["C4.3.1", "Demontree", "Plan priorise et P1 realisees", "Mesures sur une semaine"],
                    ["C4.3.2", "Prete sur la branche", "Version 0.1.41 + CHANGELOG", "Tag apres validation"],
                    ["C4.3.3", "Preuve humaine absente", "Processus et fiche prepares", "Echange reel avec un tiers"],
                ],
                [22 * mm, 35 * mm, 61 * mm, 56 * mm],
            ),
            Spacer(1, 4 * mm),
            callout(
                "Limite majeure : au 3 aout 2026, le depot GitHub ne contient aucune issue et aucune revue "
                "externe. Le critere C4.3.3 ne peut pas etre declare acquis sans interlocuteur reel.",
                tone="red",
            ),
            P("2. Architecture maintenue", "h1"),
            table(
                [
                    ["Composant", "Role", "Risque operationnel"],
                    ["web/", "Interface, replay et analyses TypeScript", "regression fonctionnelle ou performance"],
                    ["parser/", "Extraction Rust des faits GOTV", "donnees incorrectes ou import bloque"],
                    ["WASM", "Execution locale du parseur", "artefact absent, corrompu ou trop volumineux"],
                    ["IndexedDB", "Stockage local des matchs", "migration ou compatibilite des anciens imports"],
                    ["GitHub Actions", "CI, audits, deploiement et sonde", "controle absent ou faux positif"],
                    ["GitHub Pages", "Hebergement statique", "indisponibilite ou ressources manquantes"],
                ],
                [38 * mm, 64 * mm, 72 * mm],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("3. C4.1.1 - Mise a jour des dependances", "h1"),
            P("Etat existant", "h2"),
            bullet("Dependances web verrouillees par pnpm et dependances Rust verrouillees par Cargo."),
            bullet("Node 24, pnpm 11.9.0, Rust 1.95.0 et wasm-bindgen 0.2.126 sont fixes dans la chaine."),
            bullet("pnpm audit --audit-level high et cargo audit bloquent la CI."),
            bullet("Le commit 815fd82 du 30 juillet 2026 documente une correction de dependances vulnerables."),
            bullet("L'audit du 3 aout corrige RUSTSEC-2026-0190 et RUSTSEC-2026-0186 dans Cargo.lock."),
            P("Automatisation ajoutee", "h2"),
            P(
                "Le fichier .github/dependabot.yml programme chaque lundi trois controles separes : npm dans "
                "web/, Cargo dans parser/ et GitHub Actions a la racine. Cinq PR simultanees au maximum sont "
                "autorisees par ecosysteme. Aucune fusion automatique n'est activee."
            ),
            P("Ordre et type de mise a jour", "h2"),
            table(
                [
                    ["Priorite", "Type", "Decision"],
                    ["1", "Securite critique exploitable", "analyse immediate, mesure ou correctif sous 72 h"],
                    ["2", "Rupture de compatibilite", "branche dediee et plan de retour"],
                    ["3", "Correctif ou mineure", "lot mensuel apres CI complete"],
                    ["4", "Majeure", "une migration isolee avec notes de version"],
                ],
                [22 * mm, 58 * mm, 94 * mm],
            ),
            P("Sequence de validation", "h2"),
            callout(
                "lockfile fige -> audit -> tests -> lint et typage -> build -> accessibilite -> audits "
                "applicatifs -> revue -> fusion -> controle post-deploiement"
            ),
            P("Preuve et limite", "h2"),
            P(
                "La configuration prouve que le processus est implemente. La regularite ne sera prouvee "
                "qu'apres plusieurs PR Dependabot datees. Le commit 815fd82 ne conserve ni CVE ni sortie "
                "avant/apres : aucun identifiant de vulnerabilite n'est donc affirme dans ce dossier."
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("4. C4.1.2 - Supervision et alertes", "h1"),
            P("Topologie", "h2"),
            table(
                [
                    ["Etape", "Controle", "Signal"],
                    ["Avant fusion", "audit, tests, typage, build, accessibilite", "echec de PR"],
                    ["Avant deploiement", "budget JS/WASM, export statique, integrite", "deploiement bloque"],
                    ["Toutes les 6 heures", "accueil, feedback, health.json, WASM", "run et rapport"],
                    ["Incident", "echec ou seuil critique", "issue ouverte ou commentee"],
                    ["Retablissement", "sonde a nouveau valide", "preuve ajoutee et issue fermee"],
                ],
                [35 * mm, 87 * mm, 52 * mm],
            ),
            P("Sondes et finalite", "h2"),
            bullet("Accueil : code HTTP et presence du nom RoundLab."),
            bullet("Feedback : code HTTP et presence du formulaire de signalement."),
            bullet("Manifeste : schema, version, commit, date, routes et identite du WASM."),
            bullet("WASM : taille, entete WebAssembly et SHA-256 exact."),
            bullet("Performance : avertissement au-dela de 2 s, echec au-dela de 5 s."),
            bullet("Conservation : rapports JSON et Markdown gardes 90 jours."),
            P("Baseline du 3 aout 2026", "h2"),
            table(
                [
                    ["Surface", "Resultat avant fusion", "Interpretation"],
                    ["/RoundLab/", "HTTP 200", "site public disponible"],
                    ["/RoundLab/feedback/", "HTTP 200", "canal de signalement disponible"],
                    ["/RoundLab/health.json", "HTTP 404", "normal avant deploiement de 0.1.41"],
                ],
                [58 * mm, 48 * mm, 68 * mm],
            ),
            callout(
                "La sonde est testee localement mais n'est pas encore active en production. Le premier run "
                "distant reussi apres fusion sera la preuve d'activation.",
                tone="amber",
            ),
            P("Confidentialite", "h2"),
            P(
                "Aucun fichier .dem ni log navigateur n'est envoye automatiquement. La supervision controle "
                "uniquement des ressources publiques. Le diagnostic utilisateur reste volontaire et doit etre "
                "verifie avant publication."
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("5. C4.2.1 - Consignation des anomalies", "h1"),
            P(
                "La page /feedback prepare une issue GitHub. Le nouveau formulaire natif exige categorie, "
                "impact, version, navigateur, resultat observe, reproduction, resultat attendu et confirmation "
                "de confidentialite. La console Ctrl/Cmd + Shift + D permet de copier les diagnostics locaux."
            ),
            P("Cycle de traitement", "h2"),
            table(
                [
                    ["Etape", "Action", "Trace"],
                    ["1. Collecter", "formulaire ou issue", "signalement date"],
                    ["2. Qualifier", "impact, version, environnement", "priorite P0 a P3"],
                    ["3. Reproduire", "scenario minimal", "resultat observe et attendu"],
                    ["4. Diagnostiquer", "cause et hypotheses rejetees", "commentaire ou fiche"],
                    ["5. Corriger", "branche dediee", "diff et commit"],
                    ["6. Tester", "non-regression", "resultat CI"],
                    ["7. Livrer", "fusion et deploiement", "commit et run"],
                    ["8. Clore", "controle et retour utilisateur", "confirmation finale"],
                ],
                [30 * mm, 72 * mm, 72 * mm],
            ),
            P("Registre initial", "h2"),
            table(
                [
                    ["ID", "Anomalie", "Impact", "Correctif", "Preuve"],
                    ["B4-001", "croissance memoire du replay", "P1 estime", "19a13c8", "tests replay/store/Pixi"],
                    ["B4-002", "import de grande demo", "P1 estime", "c995760", "seuil, Worker et tests"],
                    ["B4-003", "dependances web vulnerables", "indetermine", "815fd82", "lockfile et audit CI"],
                    ["B4-004", "avis RustSec anyhow/memmap2", "P2 estime", "Cargo.lock", "audit final sans avis"],
                ],
                [18 * mm, 55 * mm, 29 * mm, 28 * mm, 44 * mm],
            ),
            callout(
                "Les severites B4-001 et B4-002 sont reconstruites a partir de l'impact. B4-003 reste "
                "indeterminee faute d'avis original. Ces limites sont conservees dans le registre.",
                tone="amber",
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("6. C4.2.2 - Correctif et deploiement continu", "h1"),
            P("Cas principal : import d'une grande demo", "h2"),
            P(
                "Le commit c995760 du 22 juillet 2026 corrige un depassement de memoire. Le decodeur Zstd et "
                "le parseur WASM pouvaient conserver simultanement de gros tas, tandis que l'echantillonnage "
                "complet pouvait atteindre la limite memoire 32 bits de WebAssembly."
            ),
            bullet("Decompression transferee dans un Worker court puis termine avant le parseur."),
            bullet("Buffer transfere sans copie inutile."),
            bullet("Strategie sure a partir de 384 Mio."),
            bullet("Mode precis refuse au-dessus du seuil ; mode rapide maintenu."),
            bullet("Erreurs memoire converties en message actionnable."),
            bullet("Tests de seuil, de strategie et de message d'erreur."),
            P("Deuxieme cas : croissance memoire du replay", "h2"),
            P(
                "Le commit 19a13c8 borne les payloads de rounds conserves, limite la file d'objets PixiJS "
                "detaches et detruit les ressources graphiques. Les tests verifient le voisinage des rounds, "
                "la vue condensee et la borne de destruction."
            ),
            P("Chaine de livraison prouvee", "h2"),
            table(
                [
                    ["Preuve distante", "Resultat"],
                    ["PR #2", "CI frontend et Rust reussie"],
                    ["PR #3", "deploiement puis rollback consignes"],
                    ["PR #5", "restauration et smoke test consignes"],
                    ["Run 30799703961", "CI main du 3 aout reussie"],
                    ["Run 30799877146", "deploiement correspondant reussi"],
                    ["CI echouees des 27 et 30 juillet", "deploiements automatiques ignores"],
                ],
                [68 * mm, 106 * mm],
            ),
            P(
                "Ces preuves demontrent le fonctionnement du flux CI/deploiement et du rollback. La version "
                "0.1.41 devra produire ses propres liens avant soutenance."
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("7. C4.3.1 - Axes d'amelioration", "h1"),
            table(
                [
                    ["Etat", "Recommandation", "Gain", "Cout", "Indicateur"],
                    ["Realise", "sonde planifiee", "detection proactive", "0,5 a 1 j", "succes et delai"],
                    ["Realise", "Dependabot", "reduction exposition", "0,5 j", "age des dependances"],
                    ["Realise", "changelog", "versions auditables", "15 min/livraison", "versions documentees"],
                    ["Realise", "issue form", "triage plus rapide", "0,5 j", "tickets reproductibles"],
                    ["A faire", "smoke avec vraie demo", "validation metier", "1 a 2 j", "parcours reussi"],
                    ["A etudier", "erreurs opt-in", "visibilite navigateur", "2 a 4 j", "erreurs par version"],
                ],
                [22 * mm, 49 * mm, 40 * mm, 29 * mm, 34 * mm],
            ),
            P("Analyse cout/benefice", "h2"),
            P(
                "Les priorites retenues sont peu couteuses et adaptees a un site statique en beta. Une "
                "plateforme complete d'observabilite serait disproportionnee. Une collecte automatique de "
                "demos serait mauvaise sans consentement, minimisation et duree de conservation explicites."
            ),
            P("8. C4.3.2 - Journal des versions", "h1"),
            P(
                "Le fichier CHANGELOG.md devient la source de changement livrable. La version candidate "
                "0.1.41 est declaree dans web/package.json. Son commit, sa CI, son deploiement et son premier "
                "run de supervision restent volontairement 'a completer' jusqu'a leur existence reelle."
            ),
            table(
                [
                    ["Version", "Etat", "Traçabilite"],
                    ["0.1.41", "candidate Bloc 4", "changelog present ; livraison a prouver"],
                    ["0.1.40", "candidate du 21 juillet", "commit de30fd8 et PR #2/#3/#5 ; aucun tag final"],
                    ["anciennes v0.1.x", "historique nettoye", "tags et releases supprimes via PR #11"],
                ],
                [28 * mm, 55 * mm, 91 * mm],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("9. C4.3.3 - Collaboration support et client", "h1"),
            P("Outillage disponible", "h2"),
            bullet("page de signalement integree et formulaire GitHub structure ;"),
            bullet("console de diagnostic copiable ;"),
            bullet("messages d'erreur actionnables ;"),
            bullet("fiche de collaboration avec roles, chronologie et confirmation ;"),
            bullet("checklist de confidentialite avant publication."),
            P("Preuve manquante", "h2"),
            callout(
                "Aucune issue GitHub, revue externe ou validation d'un tiers n'existe au 3 aout 2026. "
                "L'outillage ne remplace pas une collaboration reelle.",
                tone="red",
            ),
            P("Preuve minimale a obtenir", "h2"),
            table(
                [
                    ["Moment", "Preuve"],
                    ["Signalement", "demande datee d'un utilisateur, client ou support"],
                    ["Clarification", "questions, contexte et resultat attendu"],
                    ["Diagnostic", "explication comprehensible et contributions des parties"],
                    ["Livraison", "correctif, tests, commit et deploiement"],
                    ["Validation", "confirmation explicite du tiers"],
                ],
                [44 * mm, 130 * mm],
            ),
            P(
                "Si aucun tiers n'est disponible avant le jury, la bonne presentation consiste a reconnaitre "
                "que ce critere n'est pas acquis. Une fausse conversation serait facile a contester et "
                "affaiblirait tout le dossier."
            ),
            P("10. Plan de preuves avant soutenance", "h1"),
            table(
                [
                    ["Action", "Etat"],
                    ["Fusionner la branche apres CI", "a faire"],
                    ["Conserver le run CI 0.1.41", "a faire"],
                    ["Conserver le deploiement et health.json", "a faire"],
                    ["Executer manuellement la sonde", "a faire"],
                    ["Conserver plusieurs runs planifies", "a faire"],
                    ["Traiter une premiere PR Dependabot", "a faire"],
                    ["Documenter un vrai echange utilisateur", "preuve humaine obligatoire"],
                    ["Creer un tag seulement apres validation", "a faire"],
                ],
                [120 * mm, 54 * mm],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            P("11. Index des preuves", "h1"),
            table(
                [
                    ["Sujet", "Fichier ou lien"],
                    ["CI", ".github/workflows/ci.yml et _checks.yml"],
                    ["Deploiement", ".github/workflows/deploy-pages.yml"],
                    ["Supervision", ".github/workflows/monitor-production.yml"],
                    ["Sonde", "scripts/monitor-production.py"],
                    ["Manifeste", "scripts/write-deployment-manifest.py"],
                    ["Test de sonde", "scripts/tests/test_monitor_production.py"],
                    ["Dependances", ".github/dependabot.yml"],
                    ["Anomalies", ".github/ISSUE_TEMPLATE/bug-report.yml"],
                    ["Registre", "docs/bloc-4/registre-anomalies.md"],
                    ["Processus", "docs/bloc-4/processus-maintenance.md"],
                    ["Versions", "CHANGELOG.md"],
                    ["Collaboration", "docs/bloc-4/fiche-collaboration-support.md"],
                    ["Preuves datees", "docs/bloc-4/rapport-preuves-2026-08-03.md"],
                ],
                [52 * mm, 122 * mm],
            ),
            P("Sources officielles utilisees pour la configuration GitHub", "h2"),
            bullet("docs.github.com - About the dependabot.yml file"),
            bullet("docs.github.com - Keeping your actions up to date with Dependabot"),
            bullet("docs.github.com - Scheduling issue creation"),
            bullet("docs.github.com - Syntax for issue forms"),
            bullet("docs.github.com - Workflow commands and job summaries"),
            P("Conclusion", "h2"),
            P(
                "La branche couvre techniquement les attendus de maintenance : veille, controles, sonde, "
                "alertes, anomalies, correctifs, recommandations et versions. Les preuves historiques de CI, "
                "deploiement et rollback sont disponibles. Deux validations restent necessairement futures : "
                "l'activation distante de 0.1.41 et une collaboration reelle avec un tiers."
            ),
        ]
    )
    return story


def build_pdf(output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=18 * mm,
        title="RoundLab - Dossier Bloc 4",
        author="A completer",
        subject="Maintenir l'application logicielle en condition operationnelle",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="roundlab", frames=[frame], onPage=draw_page)])
    doc.build(build_story())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build_pdf(args.output.resolve())
    print(f"Bloc 4 PDF written: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
