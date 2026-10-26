import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const dist=resolve(root,'dist');
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for(const name of ['index.html','styles.css','app.js','config.js','lib','workers','vendor']){
 await cp(resolve(root,name),resolve(dist,name),{recursive:true});
}
console.log(`Built SHARV- Logistics Control tower in ${dist}`);
