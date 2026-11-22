import test from 'node:test';
import assert from 'node:assert/strict';
import {artworkIssues, createArtworkValidation} from '../studio/artwork-validation.js';

const baseURL = 'https://example.test/nest/editor.html?project=example.json';
const catalog = {version:1, images:[{path:'card-art/the door.png'}], aliases:['old-door.png']};
const chapter = {id:'chapter', name:'The Arrival', nodes:[{id:'beat', name:'A hallway',
  cards:[{id:'door', definitionId:'door'}, {id:'broken', definitionId:'broken'}]}]};

test('artwork diagnostics use the Pages base path and label shared and embedded cards', () => {
  const project = {chapters:[chapter], library:[
    {id:'door', name:'Door', image:'./assets/img/card-art/the%20door.png?cache=1'},
    {id:'broken', name:'Broken light', image:'./assets/img/missing.png'},
    {id:'legacy', name:'Legacy', image:'./assets/img/old-door.png'},
    {id:'remote', image:'https://elsewhere.test/nest/assets/img/remote.png'},
    {id:'embedded', image:'data:image/png;base64,AAAA'},
    {id:'enemy', actions:[{name:'Enemy attack', image:'./assets/img/missing-attack.png'}]},
  ], cardBack:{background:'https://example.test/nest/assets/img/missing-back.png', icons:{default:'./assets/img/old-door.png'}}};
  assert.deepEqual(artworkIssues(project,catalog,baseURL), [
    'Broken light (The Arrival) is missing artwork at assets/img/missing.png.',
    'Enemy attack (Library) is missing artwork at assets/img/missing-attack.png.',
    'Card back is missing artwork at assets/img/missing-back.png.',
  ]);
});

test('chapter export rechecks the on-disk catalog while ordinary diagnostics reuse it', async () => {
  let fetches = 0;
  const validation = createArtworkValidation({baseURL, fetch:async url => {
    assert.equal(url.href,'https://example.test/nest/assets/image-manifest.json');
    const aliases = fetches++ ? [] : catalog.aliases;
    return {ok:true, json:async () => ({...catalog, aliases})};
  }});
  const library = [{id:'door', name:'Door', image:'./assets/img/old-door.png'}];
  assert.deepEqual(await validation.projectIssues({chapters:[chapter],library}),[]);
  assert.deepEqual(await validation.projectIssues({chapters:[chapter],library}),[]);
  assert.equal(fetches,1);
  assert.deepEqual(await validation.chapterIssues({chapter,library}), [
    'Door (The Arrival) is missing artwork at assets/img/old-door.png.',
  ]);
  assert.equal(fetches,2);
});
