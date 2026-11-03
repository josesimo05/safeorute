// Public deployment diagnostics; never expose environment values or secrets.
// /api is excluded even by the earlier PWA navigation fallback.
const features = ['single-report-category','custom-incident-type','location-without-report','network-first-navigation','interactive-authority-pilot'];

export default function version(req, res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    res.statusCode = 405;
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  const candidate = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  const revision = typeof candidate === 'string' && /^[a-f\d]{7,40}$/i.test(candidate) ? candidate : null;
  res.statusCode = 200;
  return res.end(JSON.stringify({application:'SafeRoute', release:'reporting-pilot-v2', revision, features}));
}

export function versionViteProxy() {
  const install = server => {
    server.middlewares.use((req, res, next) => {
      if ((req.url || '').split('?')[0] !== '/api/version') return next();
      return version(req, res);
    });
  };
  return {name:'saferoute-version-api', configureServer:install, configurePreviewServer:install};
}
