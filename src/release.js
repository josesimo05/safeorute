export const appRelease = typeof __SAFEROUTE_RELEASE__ === 'undefined'
  ? {revision:'development', shortRevision:'dev'} : __SAFEROUTE_RELEASE__;
