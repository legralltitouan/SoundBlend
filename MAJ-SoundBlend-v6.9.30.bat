@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title SoundBlend - mise a jour v6.9.30

rem Placer ce script dans le depot Git clone.
rem Decompresser le paquet src-v6.9.30 a cote du depot.
rem Ce script ne modifie ni .git, ni .github/workflows/pages.yml.
rem Il refuse les modifications existantes et n'utilise pas reset --hard.

set "RACINE=%~dp0"
set "SRC="
for %%D in ("%RACINE%..\src-v6.9.30" "%RACINE%src-v6.9.30" "%RACINE%..\site-v6.9.30" "%RACINE%site-v6.9.30" "%RACINE%..\..\src-v6.9.30") do (
  if not defined SRC if exist "%%~fD\src\App.tsx" set "SRC=%%~fD"
)

echo.
echo ==========================================================
echo   SoundBlend - mise a jour v6.9.30
echo   Depot : %CD%
echo   Source: %SRC%
echo ==========================================================
echo.

if not defined SRC (
  echo [ERREUR] Paquet src-v6.9.30 introuvable.
  echo Decompresse soundblend-site-v6-9.zip a cote du depot, puis relance.
  echo Aucun fichier n'a ete modifie.
  pause
  exit /b 1
)
if not exist "%SRC%\package.json" goto badsource
if not exist "%SRC%\public\sw.js" goto badsource
findstr /L /C:"6.9.30" "%SRC%\package.json" >nul
if errorlevel 1 goto badsource
findstr /L /C:"sb-v6-9-30" "%SRC%\public\sw.js" >nul
if errorlevel 1 goto badsource

git --version >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Git est introuvable. Installe Git pour Windows.
  pause
  exit /b 1
)
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Place ce script DANS le depot Git clone.
  pause
  exit /b 1
)
set "BRANCHE="
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCHE=%%B"
if /I not "%BRANCHE%"=="main" (
  echo [ERREUR] La branche active doit etre main. Branche actuelle : %BRANCHE%
  echo Aucun fichier n'a ete modifie.
  pause
  exit /b 1
)

rem Ne jamais effacer ni embarquer les modifications de la personne.
set "DIRTY="
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=no') do set "DIRTY=1"
if defined DIRTY (
  echo [ERREUR] Le depot contient des modifications suivies ou deja indexees.
  echo Sauvegarde-les ou committe-les avant de relancer. Rien n'a ete modifie.
  git status --short
  pause
  exit /b 1
)
set "CONFLIT="
for /f "delims=" %%L in ('git status --porcelain --untracked-files^=all -- src public deploy verification README.md .env.example index.html package.json package-lock.json postcss.config.js tailwind.config.js vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json') do set "CONFLIT=1"
if defined CONFLIT (
  echo [ERREUR] Des fichiers locaux non suivis occupent les dossiers a mettre a jour.
  echo Sauvegarde-les ou deplace-les avant de relancer. Rien n'a ete modifie.
  git status --short -- src public deploy verification README.md .env.example index.html package.json package-lock.json postcss.config.js tailwind.config.js vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json
  pause
  exit /b 1
)

echo === 1. Mise a niveau sans effacer les changements ===
git fetch origin main
if errorlevel 1 goto giterror
git pull --ff-only origin main
if errorlevel 1 (
  echo [ERREUR] Mise a jour non rapide impossible. Le depot a ete conserve.
  echo Regle la divergence avec Git avant de relancer.
  pause
  exit /b 1
)

echo.
echo === 2. Copie des fichiers v6.9.30 ===
rem Copie par-dessus, sans supprimer les dossiers ni les fichiers ignores.
xcopy "%SRC%\src" "src\" /E /I /Y /Q >nul
if errorlevel 1 goto copyerror
xcopy "%SRC%\public" "public\" /E /I /Y /Q >nul
if errorlevel 1 goto copyerror
if exist "%SRC%\deploy\" (
  xcopy "%SRC%\deploy" "deploy\" /E /I /Y /Q >nul
  if errorlevel 1 goto copyerror
)
if exist "%SRC%\verification\" (
  xcopy "%SRC%\verification" "verification\" /E /I /Y /Q >nul
  if errorlevel 1 goto copyerror
)
for %%F in (README.md .env.example index.html package.json package-lock.json postcss.config.js tailwind.config.js vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json) do (
  if not exist "%SRC%\%%F" goto copyerror
  copy /Y "%SRC%\%%F" "%%F" >nul
  if errorlevel 1 goto copyerror
)

rem Controle de la version et du code de synchronisation.
findstr /L /C:"synchroniserClip" "src\context\PlayerContext.tsx" >nul
if errorlevel 1 goto copyerror
findstr /L /C:"v6.9.30" "src\components\views\SettingsView.tsx" >nul
if errorlevel 1 goto copyerror
findstr /L /C:"sb-v6-9-30" "public\sw.js" >nul
if errorlevel 1 goto copyerror

rem Une vraie cle API Google ne doit pas etre envoyee par accident.
findstr /S /I /C:"AIzaSy" src\*.ts src\*.tsx src\*.js src\*.jsx src\*.json index.html >nul 2>&1
if not errorlevel 1 (
  echo [ERREUR] Une chaine ressemblant a une cle Google a ete detectee.
  echo Copie effectuee, mais aucun commit ni envoi. Verifie les fichiers.
  pause
  exit /b 1
)

echo.
echo === 3. Commit et envoi des fichiers du paquet ===
rem Ne pas indexer le script ni les autres fichiers non suivis du depot.
git add -- src public deploy verification README.md .env.example index.html package.json package-lock.json postcss.config.js tailwind.config.js vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json
if errorlevel 1 goto giterror
git diff --cached --quiet
if errorlevel 2 goto giterror
if errorlevel 1 (
  git commit -m "v6.9.30 - synchronisation du clip et aide YouTube Premium"
  if errorlevel 1 goto giterror
) else (
  echo Aucun changement du paquet a committer.
)
git push origin main
if errorlevel 1 goto giterror

echo.
echo === TERMINE ===
echo Verifie GitHub Actions, puis Reglages : SoundBlend AI v6.9.30.
echo Pour Premium, connecte YouTube dans le meme navigateur et verifie ses cookies.
git log --oneline -1
pause
exit /b 0

:badsource
echo [ERREUR] Le dossier trouve ne contient pas le paquet v6.9.30 complet.
echo Aucun fichier n'a ete modifie.
pause
exit /b 1

:copyerror
echo [ERREUR] Copie ou verification incomplete. Aucun commit ni envoi.
echo Des fichiers ont pu etre copies : verifie git status avant de recommencer.
pause
exit /b 1

:giterror
echo [ERREUR] Une commande Git a echoue. Lis le message ci-dessus.
echo Un commit local peut deja exister si seul le push a echoue.
pause
exit /b 1
