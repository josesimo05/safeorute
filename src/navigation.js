import {createGeoapifyClient} from './geoapify';

const client = createGeoapifyClient({apiKey: import.meta.env.VITE_GEOAPIFY_API_KEY});
export const {hasRouting, geocode, suggestPlaces, getRoutes, nearbyPlaces, tileUrl} = client;
export const mapProvider = hasRouting ? 'geoapify' : 'osm';
export const mapAttribution = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
  + (hasRouting ? ' · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · <a href="https://www.geoapify.com/" target="_blank" rel="noopener">© Geoapify</a>' : '');
export function similarRoutes(routes,ratio=1.3){if(!routes.length)return [];const fastest=Math.min(...routes.map(r=>r.seconds).filter(Boolean));return routes.filter(r=>r.seconds<=fastest*ratio).slice(0,6);}
