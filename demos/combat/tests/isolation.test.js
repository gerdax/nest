import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
test('snapshotted runtime copies remain byte-identical to their recorded sources',()=>{const manifest=JSON.parse(readFileSync(path.join(root,'snapshot.json')));for(const file of manifest.files){assert.equal(createHash('sha256').update(readFileSync(path.join(root,file.path))).digest('hex'),file.sha256,file.path);}});
test('all static runtime module/style/asset references resolve inside isolated demo',()=>{
 for(const file of walk(root).filter(f=>/\.(js|css|html)$/.test(f)&&!f.includes(`${path.sep}tests${path.sep}`))){
  const text=readFileSync(file,'utf8');
  const refs=file.endsWith('.js')?[...text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]):file.endsWith('.css')?[...text.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)].map(m=>m[1]):[...text.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1]);
  for(const ref of refs){if(ref.startsWith('data:')||ref.startsWith('#'))continue;assert.ok(!/^https?:/.test(ref),`Remote dependency ${ref}`);const target=path.resolve(path.dirname(file),ref.split('?')[0]);assert.ok(target.startsWith(root),`Escaping reference ${file}: ${ref}`);assert.doesNotThrow(()=>readFileSync(target),`${file}: ${ref}`);}
 }
});
