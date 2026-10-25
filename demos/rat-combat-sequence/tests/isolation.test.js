import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
test('snapshot copies match declared current hashes',()=>{for(const i of JSON.parse(fs.readFileSync(path.join(root,'snapshot.json'))))assert.equal(hash(path.join(root,i.copy)),i.sha256,i.copy);});
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
test('all host imports, CSS URLs and HTML references stay inside mockup',()=>{for(const file of files(root)){if(!/\.(js|css|html)$/.test(file)||file.includes('/tests/')||file.includes('/vendor/'))continue;const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/(?:from\s*['"]|import\s*['"]|(?:src|href)=['"]|url\(['"]?)(\.[^'"\s)]+)/g)){const target=path.resolve(path.dirname(file),m[1].split('?')[0]);assert.ok(target.startsWith(root+path.sep),target);assert.ok(fs.existsSync(target),target);}}});
test('host does not import project persistence or controllers',()=>{const source=fs.readFileSync(path.join(root,'combat-demo.js'),'utf8');assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|ProjectController|project\/storage/);});

test('dice copies match manifest and preserved source hashes',()=>{const dice=JSON.parse(fs.readFileSync(path.join(root,'dice/snapshot.json')));for(const i of dice.files){assert.equal(hash(path.join(root,'dice',i.path)),i.sha256,i.path);if(i.source)assert.equal(hash(path.resolve(root,'../..',i.source)),i.sourceSha256,i.source);}});
test('all preserved source assets still match snapshot baselines',()=>{for(const i of JSON.parse(fs.readFileSync(path.join(root,'snapshot.json'))))assert.equal(hash(path.resolve(root,'../..',i.source)),i.baselineSha256??i.sha256,i.source);});
