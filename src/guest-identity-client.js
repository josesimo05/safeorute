// This request carries neither the cédula nor an account token. Only a positive,
// validated server response may choose the report submission path.
export async function fetchGuestIdentityConfig({signal, fetchImpl = fetch} = {}) {
  const response = await fetchImpl('/api/reports', {
    method: 'GET', signal, cache: 'no-store', credentials: 'omit',
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) throw new Error('REPORTS_CONFIG_UNAVAILABLE');
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.guestIdentityEnabled !== 'boolean') {
    throw new Error('REPORTS_CONFIG_UNAVAILABLE');
  }
  return payload.guestIdentityEnabled;
}

// Identity is transient POST data: never include it in report fields, a URL,
// browser storage, analytics, or an error message. Failed requests never fall
// back to the unprotected client write path.
export async function submitGuestReport({report, cedula, token, signal, fetchImpl = fetch}) {
  const response = await fetchImpl('/api/reports', {
    method: 'POST', signal, cache: 'no-store', credentials: 'omit',
    headers: {'Content-Type':'application/json', Authorization:`Bearer ${token}`},
    body: JSON.stringify({report: {
      category:report.category, description:report.description, lat:report.lat,
      lng:report.lng, occurredAt:report.occurredAt,
    }, cedula}),
  });
  const fail = code => Object.assign(new Error(code), {code});
  let payload;
  try {payload = await response.json();} catch {throw fail('REPORTS_UNAVAILABLE');}
  if (!response.ok) {
    const codes = ['REPORTS_AUTH_REQUIRED', 'REPORTS_RATE_LIMIT', 'REPORTS_NOT_CONFIGURED', 'REPORTS_INVALID_REQUEST', 'REPORTS_BODY_TOO_LARGE'];
    throw fail(codes.includes(payload?.error) ? payload.error : 'REPORTS_UNAVAILABLE');
  }
  if (typeof payload?.id !== 'string' || !payload.id || payload.status !== 'pending') throw fail('REPORTS_UNAVAILABLE');
  return payload;
}
