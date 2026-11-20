# SoundBlend — V12 : voix Live et inspirations

## Changements

### Voix Live
- La voix générée passe désormais par un GainNode, puis une destination MediaStream et un élément audio HTML. Cette voie de lecture multimédia peut permettre au navigateur de mieux intégrer la sortie aux commandes du téléphone.
- **Ce n’est pas une garantie de contrôle par les boutons du téléphone.** Quand le micro est ouvert, le navigateur et le système peuvent conserver une catégorie audio d’appel/communication. Une page web ne peut ni imposer cette catégorie ni détecter que les boutons de volume sont inefficaces. Aucun essai sur téléphone physique n’a été effectué ici.
- Le démarrage du lecteur est demandé dans le geste initial. En cas de refus, d’erreur, d’exception ou de promesse de lecture toujours bloquée après 3 secondes, la sortie revient automatiquement au graphe audio direct, sans doubler la lecture.
- Le lien discret **« Voix trop forte ? »** ouvre, uniquement sur demande, une atténuation de secours de 0 à 100 %. Il recommande d’abord les boutons du téléphone. Le site ne décide pas automatiquement que le volume système est défaillant.
- L’atténuation agit dans le graphe de la voix IA, pas sur la musique ni sur les données du micro. Le niveau est mémorisé localement sur cet appareil/origine ; aucun envoi Drive ou Gemini. Ce n’est pas un réglage propre au compte. Après réduction, le lien affiche le pourcentage pour éviter un volume réduit inexpliqué lors d’une prochaine session. Une commande réinitialise à 100 %.
- À Terminer, en cas de changement de compte, de fermeture ou de reconstruction du moteur : suppression du lecteur, arrêt de ses pistes de sortie et nettoyage des abonnements. Le micro conserve ses contraintes, ses traitements et ses moteurs de capture V8.

### Sélecteur d’inspirations
- Suppression du focus automatique de la recherche.
- Le bouton Fermer reçoit le focus initial : pas de champ de texte activé à l’ouverture. Le clavier virtuel ne devrait donc plus être sollicité automatiquement ; son comportement physique reste à confirmer sur mobile.
- La recherche reste focalisable en la touchant. Échap ferme la fenêtre et le focus revient au bouton ouvrant.

## Périmètre

Quatre fichiers existants modifiés : `geminiLive.ts`, `AssistantBlendDesign.tsx`, `AssistantView.tsx`, `AssistantView.css`.
Nouveaux fichiers : service `liveVoiceOutput.ts`, trois scripts de vérification V12, ce rapport.
Navbar, dépendances, service worker, synchronisation Drive/historique et orchestration des préparations V11.1 inchangés. Pas de serveur ajouté. Aucun commit, push ou déploiement effectué.

## Vérifications

Chromium réel avec graphe audio réel, micro factice et services Google/Gemini simulés. Les tests ne valident ni une connexion Gemini payante réelle, ni le comportement des boutons matériels, ni le routage Bluetooth ou la catégorie de volume d’un OS mobile.

| Suite | Développement | Version compilée |
|---|---:|---:|
| Signal audio, GainNode, repli et nettoyage V12 | 12 | — |
| Secours intégré Live V12, dont 2 audits axe par exécution | 10 | 10 |
| Focus inspirations V12, dont 1 audit axe par exécution | 5 | 5 |
| Activation V8, dont 2 audits axe, politique de geste stricte | 53 | — |
| Live : capture, interruptions, sécurité, relances | 26 | 26 |
| Navigation/continuité V11.1 | 38 | 34 |
| Curseur et aperçu, dont 8 audits axe | 75 | — |
| Historique V11, dont 4 audits axe | 66 | — |
| **Total** | **285** | **75** |

**360 contrôles réussis, dont 20 audits axe.**
Le test audio mesure une atténuation du signal d’environ 80 % à un réglage de 20 %, et un signal nul à 0 %. Il couvre les refus de `play()`, exception synchrone, promesse bloquée, événement erreur et résolution tardive après arrêt.

- Build TypeScript/Vite réussi. Avertissement de taille de chunk toujours présent.
- Lint : 0 erreur ; 83 avertissements existants.
- `git diff --check` réussi.
- Les patchs sont testés séparément contre le ZIP V11.1 livré et le commit de base ; les arbres appliqués et le ZIP sont comparés octet par octet. Détail dans `livraison/tests/validation-patchs-et-perimetre.txt` du ZIP.

## Essai demandé sur ton téléphone

1. Installer/déployer cette version puis fermer et rouvrir l’application installée pour charger les nouveaux fichiers.
2. Ouvrir Live, demander une courte réponse et essayer les boutons de volume **pendant que l’IA parle**.
3. Vérifier que le micro fonctionne toujours et qu’une relance de Live fonctionne aussi.
4. Si la voix reste trop forte : ouvrir « Voix trop forte ? » et essayer 20–30 %. Le réglage n’affecte que la voix IA. À 0 %, elle est muette.
5. Proposition → ajustements → choix des inspirations : vérifier que le clavier reste fermé jusqu’à toucher la recherche.
6. Si le volume système ne fonctionne toujours pas, comparer avec un onglet normal et préciser le modèle de téléphone, l’OS, le navigateur/version et l’usage éventuel d’un casque/Bluetooth.

## Livraison

- ZIP complet des sources : `SoundBlend-Assistant-V12.zip` (pas un dossier compilé prêt à héberger).
- Patch incrémental **V11.1 → V12** : ne pas appliquer sur une version antérieure.
- Patch complet contre `51f92aa586dfc63119f697acf1ec8781128355e1` : alternative au patch incrémental, ne pas appliquer les deux.
- Rapport, captures et journaux de tests inclus ; empreintes dans `SHA256SUMS.txt`.
