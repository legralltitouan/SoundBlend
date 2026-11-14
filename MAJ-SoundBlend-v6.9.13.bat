@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title SoundBlend - mise a jour v6.9.13

rem ═══════════════════════════════════════════════════════════════
rem  Mise a jour du depot SoundBlend (structure « a la racine »).
rem
rem  Place ce fichier DANS le dossier du depot clone
rem  (C:\Users\Utilisateur\Downloads\SoundBlend), avec le dossier
rem  site-v6.9.13 juste a cote. C'est deja ton cas.
rem
rem  Ce script ne touche JAMAIS a .github\ ni a .git\ : ton
rem  pages.yml reste celui qui fonctionne.
rem ═══════════════════════════════════════════════════════════════

set "SRC=..\site-v6.9.13"

echo.
echo ==========================================================
echo   SoundBlend - mise a jour v6.9.13
echo   Depot : %CD%
echo   Source: %SRC%
echo ==========================================================
echo.

rem ── 0. verifications avant de commencer ──────────────────────
if not exist "%SRC%\" (
    echo [ERREUR] Dossier "%SRC%" introuvable.
    echo          Il doit etre a cote du dossier SoundBlend.
    pause
    exit /b 1
)
if not exist "%SRC%\src\App.tsx" (
    echo [ERREUR] "%SRC%" ne ressemble pas au paquet v6.9.13
    echo          ^(src\App.tsx absent^). Verifie que le zip a bien ete decompresse.
    pause
    exit /b 1
)
if not exist ".git\" (
    echo [ERREUR] Ce dossier n'est pas un depot git.
    echo          Lance ce script depuis le dossier SoundBlend clone.
    pause
    exit /b 1
)
if not exist ".github\workflows\pages.yml" (
    echo [ATTENTION] .github\workflows\pages.yml est absent du depot.
    echo             Le script continue, mais GitHub ne publiera rien.
    echo.
)

rem ── 1. base propre : on se cale exactement sur GitHub ────────
rem  « git pull » echoue ou bloque des que le dossier local a la
rem  moindre difference. fetch + reset --hard remet le dossier dans
rem  l'etat exact de GitHub, a chaque fois, sans question.
echo === 1. Remise a niveau depuis GitHub ===
git fetch origin main
if errorlevel 1 (
    echo [ERREUR] Impossible de joindre GitHub. Verifie ta connexion.
    pause
    exit /b 1
)
git reset --hard origin/main
if errorlevel 1 (
    echo [ERREUR] La remise a niveau a echoue.
    pause
    exit /b 1
)
echo.

rem ── 2. nettoyage des dossiers qui vont etre remplaces ────────
echo === 2. Nettoyage des anciens dossiers ===
if exist "src"    rmdir /s /q "src"
if exist "public" rmdir /s /q "public"
if exist "deploy" rmdir /s /q "deploy"
echo     src, public, deploy : effaces.
echo.

rem ── 3. copie des fichiers v6.9.13 ─────────────────────────────
echo === 3. Copie des nouveaux fichiers (v6.9.13) ===
xcopy "%SRC%\src"    "src\"    /E /I /Y /Q >nul
xcopy "%SRC%\public" "public\" /E /I /Y /Q >nul
if exist "%SRC%\deploy\" xcopy "%SRC%\deploy" "deploy\" /E /I /Y /Q >nul

copy /Y "%SRC%\index.html"         . >nul
copy /Y "%SRC%\package.json"       . >nul
copy /Y "%SRC%\package-lock.json"  . >nul
copy /Y "%SRC%\postcss.config.js"  . >nul
copy /Y "%SRC%\tailwind.config.js" . >nul
copy /Y "%SRC%\vite.config.ts"     . >nul
copy /Y "%SRC%\tsconfig.json"      . >nul
copy /Y "%SRC%\tsconfig.app.json"  . >nul
copy /Y "%SRC%\tsconfig.node.json" . >nul
echo     fichiers de la racine : copies.
echo.

rem ── 4. controle des cles ─────────────────────────────────────
rem  L'ancien motif « AIza[0-9A-Za-z_-][0-9A-Za-z_-]* » exigeait UN
rem  seul caractere apres AIza : il attrapait les textes d'aide
rem  placeholder="AIza..." de l'ecran Reglages. Une vraie cle Google
rem  commence par AIzaSy et fait 39 caracteres. On cherche donc ce
rem  prefixe : aucun faux positif possible, aucune cle ne passe.
echo === 4. Verification des cles API ===
set "FOUND="

findstr /S /I /C:"AIzaSy" src\*.ts src\*.tsx src\*.js src\*.jsx src\*.json index.html >nul 2>&1
if not errorlevel 1 set "FOUND=1"

findstr /S /I /C:"apps.googleusercontent.com" src\*.ts src\*.tsx >nul 2>&1
if not errorlevel 1 (
    echo     [info] un identifiant OAuth est present : ce n'est PAS un secret Google,
    echo            il est public par nature. Rien a faire.
)

if defined FOUND (
    echo.
    echo [ALERTE] Une cle API ressemble a une VRAIE cle ^(AIzaSy...^).
    echo          Envoi annule. Voici ou :
    echo.
    findstr /S /I /N /C:"AIzaSy" src\*.ts src\*.tsx src\*.js src\*.jsx src\*.json index.html
    echo.
    echo          Retire-la du fichier, puis relance ce script.
    pause
    exit /b 1
)
echo     Aucune cle detectee : parfait.
echo.

rem ── 5. envoi ─────────────────────────────────────────────────
echo === 5. Envoi vers GitHub ===
git add -A
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "v6.9.13 - quota Gemini : modele de secours, cles de secours, blend par voisinage"
    git push origin main
    if errorlevel 1 (
        echo.
        echo [ERREUR] Le push a echoue. Causes possibles :
        echo          - mot de passe refuse : GitHub demande un JETON, pas ton mot de passe
        echo          - droits insuffisants sur le depot
        pause
        exit /b 1
    )
) else (
    echo     Rien a envoyer : le depot est deja a jour.
)

echo.
echo === VERIFICATION ===
git log --oneline -1
echo.
echo === TERMINE ===
echo  Etapes suivantes :
echo   1. Onglet Actions sur GitHub : la pastille doit passer au vert ^(1-2 min^).
echo   2. Ouvre le site, va dans Reglages : la ligne du bas doit afficher v6.9.13.
echo   3. Sur le telephone, ferme l'onglet et rouvre-le ^(cache du service worker^).
echo.
pause
