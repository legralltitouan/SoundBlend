@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title SoundBlend - mise a jour v6.9.22

rem ═══════════════════════════════════════════════════════════════
rem  Mise a jour du depot SoundBlend (v6.9.22 — synchro Google Drive).
rem
rem  Place ce fichier DANS le dossier du depot clone
rem  (C:\Users\Utilisateur\Downloads\SoundBlend), avec le dossier
rem  site-v6.9.22 juste a cote. C'est deja ton cas.
rem
rem  Ce script ne touche JAMAIS a .github\ ni a .git\ : ton
rem  pages.yml reste celui qui fonctionne.
rem ═══════════════════════════════════════════════════════════════

rem ── 0. ou est le dossier a copier ? ──────────────────────────────
rem  Il a peut-etre ete decompresse a cote du depot (../site-v6.9.22),
rem  dedans, ou n'importe ou ailleurs. On cherche au lieu de le
rem  supposer : c'est ce qui a fait echouer les fois precedentes.
set "SRC="
set "RACINE=%~dp0"
for %%D in ("%RACINE%..\site-v6.9.22" "%RACINE%site-v6.9.22" "%RACINE%src-v6.9.22" "%RACINE%..\src-v6.9.22" "%RACINE%..\..\site-v6.9.22") do (
    if not defined SRC if exist "%%~fD\src\App.tsx" set "SRC=%%~fD"
)
if not defined SRC (
    for /d %%D in ("%RACINE%*v6.9.22*" "%RACINE%..\*v6.9.22*") do (
        if not defined SRC if exist "%%~fD\src\App.tsx" set "SRC=%%~fD"
    )
)

echo.
echo ==========================================================
echo   SoundBlend - mise a jour v6.9.22
echo   Depot : %CD%
echo   Source: %SRC%
echo ==========================================================
echo.

rem ── 0. verifications avant de commencer ──────────────────────
if not defined SRC (
    echo [ERREUR] Dossier du paquet v6.9.22 introuvable.
    echo.
    echo          Ce script a cherche, a cote de ce fichier :
    echo            ..\site-v6.9.22   .\site-v6.9.22   .\src-v6.9.22
    echo          et tout dossier dont le nom contient « v6.9.22 ».
    echo.
    echo          Verifie que le zip soundblend-site-v6-9.zip est bien
    echo          decompresse, puis relance. Rien n'a ete modifie.
    pause
    exit /b 1
)
if not exist "%SRC%\src\App.tsx" (
    echo [ERREUR] "%SRC%" ne ressemble pas au paquet v6.9.22
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

rem ── 3. copie des fichiers v6.9.21 ─────────────────────────────
echo === 3. Copie des nouveaux fichiers (v6.9.22) ===
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

rem ── 3 bis. preuve que le code est bien arrive ────────────────────
rem  La v6.9.21 a « reussi » en n'envoyant qu'un fichier .bat : git
rem  commit sans rien dedans. Ce controle rend cela impossible.
if not exist "src\config\app.ts" (
    echo [ERREUR] src\config\app.ts est absent : la copie n'a pas eu lieu.
    pause
    exit /b 1
)
findstr /C:"GOOGLE_CLIENT_ID" "src\config\app.ts" >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Le code copie n'est pas celui de la v6.9.22.
    pause
    exit /b 1
)
if not exist "src\services\drive.ts" (
    echo [ALERTE] La synchro Drive est absente du code copie.
    echo          Tu as peut-etre decompresse l'ancien paquet.
    pause
    exit /b 1
)
findstr /C:"syncNow" "src\context\DataContext.tsx" >nul 2>&1
if errorlevel 1 (
    echo [ALERTE] Le branchement de la synchro est absent du contexte.
    echo          Le code copie n'est pas complet.
    pause
    exit /b 1
)
echo     controle : code v6.9.22 present, synchro incluse.
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
    git commit -m "v6.9.22 - synchro par Google Drive (gouts, avis, mode, cle)"
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
echo   2. Ouvre le site, va dans Reglages : la ligne du bas doit afficher v6.9.22.
echo   3. Sur le telephone, ferme l'onglet et rouvre-le ^(cache du service worker^).
echo.
pause
