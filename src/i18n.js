import {translations} from './translations.js';

export const languages = Object.freeze([
  {code: 'es', nativeName: 'Español', dir: 'ltr'},
  {code: 'en', nativeName: 'English', dir: 'ltr'},
  {code: 'fr', nativeName: 'Français', dir: 'ltr'},
  {code: 'pt', nativeName: 'Português', dir: 'ltr'},
  {code: 'de', nativeName: 'Deutsch', dir: 'ltr'},
  {code: 'it', nativeName: 'Italiano', dir: 'ltr'},
  {code: 'ar', nativeName: 'العربية', dir: 'rtl'},
  {code: 'zh', nativeName: '简体中文', dir: 'ltr'},
].map(language => Object.freeze(language)));

export function resolveLanguage(locale) {
  const code = typeof locale === 'string' ? locale.trim().toLowerCase().split(/[-_]/)[0] : '';
  return languages.some(language => language.code === code) ? code : 'es';
}

export function getDirection(locale) {
  return languages.find(language => language.code === resolveLanguage(locale)).dir;
}

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}

// Only these app-generated numeric messages can be recognized after interpolation.
// User descriptions, addresses and provider instructions must never be scanned.
const numericTemplates = [
  '{count} reportes',
  '{count} rutas disponibles',
  'Ruta {number}',
  'Geoapify calculó {count} rutas distintas.',
  '{count} reportes a 150 m',
  '{minutes} min sobre la ruta más rápida.',
  '{count} reportes comunitarios cercanos al trayecto.',
];
const numericPatterns = numericTemplates.map(source => {
  const names = [];
  const pattern = source.split(/(\{[a-zA-Z]+\})/).map(part => {
    if (/^\{[a-zA-Z]+\}$/.test(part)) {
      names.push(part.slice(1, -1));
      return '(\\d+(?:[.,]\\d+)?)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return {source, names, pattern: new RegExp(`^${pattern}$`)};
});

export function translateText(source, locale = 'es', values = {}) {
  if (typeof source !== 'string') return source;
  const language = resolveLanguage(locale);
  const catalog = translations[language];
  const parameters = values && typeof values === 'object' ? values : {};
  if (Object.hasOwn(catalog, source)) return interpolate(catalog[source], parameters);
  for (const {source: template, names, pattern} of numericPatterns) {
    const match = source.match(pattern);
    if (match && Object.hasOwn(catalog, template)) {
      return interpolate(catalog[template], Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
    }
  }
  return interpolate(source, parameters);
}
