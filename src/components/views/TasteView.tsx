/* Compatibilité pour une mise à jour par simple copie depuis la 6.9.30.
   L’ancienne page de votes n’existe plus : la navigation utilise directement
   AssistantView. Ce fichier remplace l’ancien au lieu de le laisser traîner. */
export { AssistantView as TasteView } from './AssistantView';
