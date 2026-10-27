function validPoint(point) {
  return point != null
    && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lon) && Math.abs(point.lon) <= 180;
}

const coordinates = point => `${point.lat},${point.lon}`;

/**
 * Build an HTTPS navigation link from the selected places, before route snapping.
 * Returns null for unsupported providers or missing/invalid {lat, lon} points.
 * Follow this URL with a user-clicked anchor so mobile universal links can open
 * the installed app; the HTTPS page remains available when it is not installed.
 * Waze's canonical link format: https://developers.google.com/waze/deeplinks
 */
export function navigationUrl(app, places) {
  const {origin, destination} = places ?? {};
  if (!validPoint(origin) || !validPoint(destination)) return null;

  let url;
  if (app === 'Waze') {
    url = new URL('https://www.waze.com/ul');
    url.searchParams.set('ll', coordinates(destination));
    url.searchParams.set('navigate', 'yes');
    url.searchParams.set('utm_source', 'saferoute');
  } else if (app === 'Apple Maps') {
    url = new URL('https://maps.apple.com/');
    url.searchParams.set('saddr', coordinates(origin));
    url.searchParams.set('daddr', coordinates(destination));
    url.searchParams.set('dirflg', 'd');
  } else if (app === 'Google Maps') {
    url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('origin', coordinates(origin));
    url.searchParams.set('destination', coordinates(destination));
    url.searchParams.set('travelmode', 'driving');
  } else {
    return null;
  }
  return url.href;
}
