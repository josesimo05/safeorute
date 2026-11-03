import {execFileSync} from 'node:child_process';

export const featureSet = Object.freeze([
  'single-report-category', 'custom-incident-type', 'location-without-report',
  'private-guest-identity-opt-in', 'network-first-navigation', 'interactive-authority-pilot',
]);

export function buildRelease(env = process.env) {
  let revision = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || '';
  if (!/^[a-f\d]{7,40}$/i.test(revision)) {
    try {revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}).trim();}
    catch {revision = 'development';}
  }
  return {application:'SafeRoute', revision, shortRevision:revision.slice(0, 7), builtAt:new Date().toISOString(), features:featureSet};
}

export function releasePlugin(release) {
  return {
    name:'saferoute-release',
    generateBundle() {
      this.emitFile({type:'asset', fileName:'version.json', source:JSON.stringify(release, null, 2)});
    },
    transformIndexHtml: {
      order:'post',
      handler(_html, context) {
        if (context.path.startsWith('/piloto/')) return;
        return [{tag:'meta', attrs:{name:'saferoute-revision', content:release.revision}, injectTo:'head'}];
      },
    },
  };
}

// The prototype has its own entry and does not install the citizen PWA. VitePWA
// adds a manifest to every HTML entry, so remove it only from the pilot page.
export function isolatePilotPlugin() {
  return {
    name:'saferoute-isolate-pilot', enforce:'post',
    transformIndexHtml: {
      order:'post',
      handler(html, context) {
        if (!context.path.startsWith('/piloto/')) return html;
        return html.replace(/<link\b(?=[^>]*\brel=["']manifest["'])[^>]*>/gi, '');
      },
    },
  };
}
