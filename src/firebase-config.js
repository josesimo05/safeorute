// Firebase Web configuration is public and ships with the browser application.
// Never put service-account credentials or private keys in this file.
export const defaultFirebaseConfig = Object.freeze({
  apiKey: 'AIzaSyCiZ59lsOP-dPj_WEPa-v6h3CZQ74W0vf0',
  authDomain: 'saferoute-f87c1.firebaseapp.com',
  projectId: 'saferoute-f87c1',
  storageBucket: 'saferoute-f87c1.firebasestorage.app',
  messagingSenderId: '648220987452',
  appId: '1:648220987452:web:0512d9c04e89f5488bf339',
});

export function firebaseSettings(env = {}) {
  if (env.VITE_DEMO_MODE === 'true') return {cloud: false, config: null};
  const fields = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  // A different project must supply its own complete web configuration.
  // Do not accidentally mix its project ID with SafeRoute's API key/app ID.
  const overridden = Object.values(fields).some(value => value?.trim());
  const config = overridden
    ? Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value?.trim() || '']))
    : {...defaultFirebaseConfig};
  return {cloud: Object.values(config).every(Boolean), config};
}
