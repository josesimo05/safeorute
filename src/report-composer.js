const descriptionLimit = 600;
const clean = value => typeof value === 'string' ? value.trim() : '';

// Keep the six stored categories compatible with the existing Firestore rules.
// A citizen's own type belongs to this report's text, not the global catalog.
export function composeReportDescription({category, description, customType, fallback} = {}) {
  const detail = clean(description);
  const type = category === 'Otro' ? clean(customType) : '';
  if (type) return `${type}: ${detail || clean(fallback)}`;
  if (detail) return detail;
  return category === 'Otro' ? '' : clean(fallback);
}

// Budget the whole persisted description, including its custom-type prefix.
// Callers validate the result; composition never silently truncates citizen text.
export function reportDetailsLimit(category, customType) {
  const type = category === 'Otro' ? clean(customType) : '';
  return Math.max(0, descriptionLimit - (type ? type.length + 2 : 0));
}

// Older "Otro" records have no separate type. Compare their full description;
// new records can compare the short type while their additional detail varies.
export function reportDuplicateIdentity(description) {
  const text = clean(description);
  const separator = text.indexOf(': ');
  const identity = separator > 0 && separator <= 60 ? text.slice(0, separator) : text;
  return identity.normalize('NFKC').toLocaleLowerCase('es')
    .normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, ' ').trim();
}
