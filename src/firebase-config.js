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
  // Public production builds must share reports even if an old Vercel setting
  // still says VITE_DEMO_MODE=true. A deployable demo uses --mode demo explicitly.
  const demo = env.MODE === 'demo' || (env.MODE !== 'production' && env.VITE_DEMO_MODE === 'true');
  if (demo) return {mode: 'demo', cloud: false, config: null, configurationError: ''};
  const fields = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  // A different project must supply its own complete web configuration.
  // Do not accidentally mix its project ID with SafeRoute's API key/app ID.
  const overridden = Object.values(fields).some(value => value != null &&
    (typeof value !== 'string' || value.trim() !== ''));
  const provided = Object.entries(fields).filter(([,value]) => value != null &&
    (typeof value !== 'string' || value.trim() !== ''));
  const sameDefaultProject = provided.every(([key,value]) =>
    typeof value === 'string' && value.trim() === defaultFirebaseConfig[key]);
  // Completing matching fragments of our own public project is safe. Never
  // combine a partial different project/key/domain with these defaults.
  const config = !overridden || sameDefaultProject
    ? {...defaultFirebaseConfig}
    : Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : '']));
  // Invalid production configuration must never turn a successful submission
  // into browser-local demo data that other people cannot receive.
  if (!Object.values(config).every(Boolean)) {
    return {mode: 'invalid', cloud: false, config: null, configurationError: 'firebase/configuration-incomplete'};
  }
  return {mode: 'cloud', cloud: true, config, configurationError: ''};
}
