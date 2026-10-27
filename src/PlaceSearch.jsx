import {useEffect, useRef, useState} from 'react';
import {geocode, suggestPlaces} from './navigation';
import {useI18n} from './LocaleContext';

export default function PlaceSearch({id, label, value, selected, onChange, onSelect, onUseLocation, onPickOnMap, onFocusChange, bias, country = 'all'}) {
  const {t, language} = useI18n();
  const displayLabel = t(label);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [manual, setManual] = useState(null);
  const input = useRef(null);
  const root = useRef(null);
  const request = useRef(null);
  const sequence = useRef(0);
  const listId = `${id}-options`;
  const query = value.trim();

  async function search(text, manual = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++sequence.current;
    setStatus('loading');
    setError('');
    setOpen(true);
    try {
      const options = {signal: controller.signal, bias, country, language};
      const found = await (manual ? geocode(text, options) : suggestPlaces(text, options));
      if (controller.signal.aborted || version !== sequence.current) return;
      setResults(found.slice(0, 6));
      setActive(-1);
      setStatus(found.length ? 'ready' : 'empty');
    } catch (failure) {
      if (controller.signal.aborted || version !== sequence.current) return;
      setResults([]);
      setActive(-1);
      setStatus('error');
      setError(failure.message || 'No se pudo buscar. Vuelve a intentarlo.');
    }
  }

  useEffect(() => {
    request.current?.abort();
    sequence.current++;
    setResults([]);
    setActive(-1);
    setError('');
    if (!focused || selected || query.length < 3) {
      setStatus('idle');
      setOpen(false);
      return;
    }
    setStatus('loading');
    setOpen(true);
    const manualSearch = manual?.query === query;
    const timer = manualSearch ? null : setTimeout(() => search(query), 300);
    if (manualSearch) search(query, true);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [value, selected, focused, bias?.lat, bias?.lon, country, language, manual]);

  useEffect(() => {
    if (active >= 0) root.current?.querySelector(`#${listId}-${active}`)?.scrollIntoView({block: 'nearest'});
  }, [active]);

  function choose(result) {
    request.current?.abort();
    sequence.current++;
    setOpen(false);
    setResults([]);
    setStatus('idle');
    setManual(null);
    onSelect(result);
    input.current?.blur();
  }

  function keyDown(event) {
    if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
      event.preventDefault();
      setOpen(true);
      setActive(index => event.key === 'ArrowDown'
        ? (index + 1) % results.length
        : (index <= 0 ? results.length - 1 : index - 1));
    }
    if (event.key === 'Enter' && !selected) {
      event.preventDefault();
      if (open && active >= 0 && results[active]) choose(results[active]);
      else if (query.length >= 3) setManual({query});
    }
  }

  return <div className="place-search" ref={root} onBlur={event => {
    if (!root.current?.contains(event.relatedTarget)) { setFocused(false); setOpen(false); onFocusChange?.(false); }
  }}>
    <label htmlFor={id} className="search-label"><span className={`endpoint-label ${id}`}>{id === 'origin' ? 'A' : 'B'}</span>{displayLabel}</label>
    <div className="search-control">
      <input ref={input} id={id} dir="auto" role="combobox" aria-label={displayLabel}
        aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={`${id}-status`} autoComplete="off" enterKeyHint="search"
        value={value} placeholder={id === 'origin' ? t('Lugar, colegio o dirección de origen') : t('¿Adónde quieres ir?')}
        onFocus={() => {setFocused(true); onFocusChange?.(true);}} onKeyDown={keyDown}
        onChange={event => {setManual(null); onChange(event.target.value);}}/>
      {value && <button type="button" aria-label={t('Borrar {field}', {field: displayLabel})} onClick={() => {setManual(null); onChange(''); input.current?.focus();}}>×</button>}
      <button type="button" title={t('Usar mi ubicación')} aria-label={t('Usar mi ubicación como {field}', {field: displayLabel})} onClick={onUseLocation}>◎</button>
    </div>
    <div id={`${id}-status`} className="search-status" role="status">
      {open && status === 'loading' && t('Buscando lugares…')}
      {open && status === 'empty' && t('No encontramos ese lugar. Añade el sector, la ciudad o una dirección.')}
      {open && status === 'error' && t(error)}
      {selected && <span className="place-selected">✓ {t('Ubicación seleccionada')}</span>}
    </div>
    {open && results.length > 0 && <div id={listId} className="suggestion-list" role="listbox" aria-label={t('Sugerencias para {field}', {field: displayLabel})}>
      {results.map((result, index) => <button type="button" role="option" id={`${listId}-${index}`}
        key={result.id || `${result.position.lat}-${result.position.lon}`} aria-selected={active === index}
        className={`suggestion ${active === index ? 'suggestion-active' : ''}`}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(result)}>
        <strong dir="auto">{result.name || result.poi?.name || result.address?.freeformAddress || t('Lugar encontrado')}</strong>
        {(result.name || result.poi?.name) && <span dir="auto">{result.address?.freeformAddress}</span>}
      </button>)}
    </div>}
    <details className="search-other-options"><summary aria-label={t('Más opciones para {field}', {field: displayLabel})}>{t('Otras formas de elegir')}</summary><div className="field-actions">
      <button type="button" onClick={() => {setFocused(true); input.current?.focus(); if(query.length >= 3) setManual({query});}} aria-label={t('Buscar {field}', {field: displayLabel})}>{t('Buscar por nombre')}</button>
      <button type="button" onClick={onPickOnMap}>{t('Elegir en mapa')}</button>
    </div></details>
  </div>;
}
