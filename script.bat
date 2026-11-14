# 2. on remplace le contenu de l'app, sans jamais toucher au workflow
SRC="../site-v6.9.8"

cp -r  "$SRC/src"    .
cp -r  "$SRC/public" .
cp -r  "$SRC/deploy" .
cp     "$SRC/index.html"        .
cp     "$SRC/package.json"      .
cp     "$SRC/package-lock.json" .
cp     "$SRC/postcss.config.js" .
cp     "$SRC/tailwind.config.js" .
cp     "$SRC/vite.config.ts"    .
cp     "$SRC/tsconfig.json"     .
cp     "$SRC/tsconfig.app.json" .
cp     "$SRC/tsconfig.node.json" .

# 3. on vérifie qu'aucune clé ne part
grep -rInE "AIza[0-9A-Za-z_-]{20,}" . --exclude-dir=.git || echo "aucune clé : parfait"

# 4. on regarde ce qui va partir, puis on envoie
git status --short
git add -A
git commit -m "v6.9.8 — player au doigt, timeline réparée, doublons verrouillés"
git push