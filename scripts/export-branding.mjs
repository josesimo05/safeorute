// Mechanical PNG exports from the approved logo source; no build dependency.
// Requires ImageMagick 7 locally. The app uses the committed exported assets.
import {execFileSync} from 'node:child_process';
import {mkdirSync, copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.join(root,'assets/branding/logo-source.png');
// Ignore faint transparent-border pixels when calculating the export bounds.
const bounds=execFileSync('magick',[source,'-alpha','extract','-threshold','5%','-format','%@','info:'],{encoding:'utf8'}).trim();
if(!/^\d+x\d+\+\d+\+\d+$/.test(bounds))throw new Error('Invalid logo export bounds');
const exports=[
  ['brand-mark.png','152x176',null],
  ['icon-192.png','150x154','192x192'],
  ['icon-512.png','400x410','512x512'],
  ['icon-maskable-512.png','280x320','512x512'],
  ['apple-touch-icon.png','140x144','180x180'],
];
mkdirSync(path.join(root,'public'),{recursive:true});
for(const[name,size,extent]of exports){
  const args=[source,'-crop',bounds,'+repage','-resize',size];
  if(extent)args.push('-gravity','center','-background','#F5F8FA','-extent',extent);
  execFileSync('magick',[...args,path.join(root,'public',name)]);
}
copyFileSync(path.join(root,'public/brand-mark.png'),path.join(root,'traffic-its/src/traffic_its/static/brand-mark.png'));
console.log('Exported the brand mark, PWA icons and ITS logo.');
