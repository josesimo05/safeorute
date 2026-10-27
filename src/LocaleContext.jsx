import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {getDirection, resolveLanguage, translateText} from './i18n';

const LocaleContext = createContext(null);
function initialLanguage() {
  try {
    const saved = localStorage.getItem('saferoute-language');
    if (saved) return resolveLanguage(saved);
  } catch {}
  return resolveLanguage(navigator.language || 'es');
}

export function LocaleProvider({children}) {
  const [language, updateLanguage] = useState(initialLanguage);
  const setLanguage = useCallback(code => updateLanguage(resolveLanguage(code)), []);
  const t = useCallback((source, values) => translateText(source, language, values), [language]);
  const dir = getDirection(language);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    try { localStorage.setItem('saferoute-language', language); } catch {}
  }, [language, dir]);
  const context = useMemo(() => ({language, setLanguage, dir, t}), [language, setLanguage, dir, t]);
  return <LocaleContext.Provider value={context}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LocaleProvider is required.');
  return value;
}
