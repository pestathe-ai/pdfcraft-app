/**
 * Modalità "app Android": attiva quando il sito viene compilato per l'APK
 * (NEXT_PUBLIC_APP_MODE=android). Interfaccia compatta pensata per il telefono.
 */
export const APP_MODE = process.env.NEXT_PUBLIC_APP_MODE === 'android';
