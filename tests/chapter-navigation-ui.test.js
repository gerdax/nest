import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createChapter} from '../project/model.js';
import {projectSettingsInspector,chapterSettingsInspector} from '../studio/inspectors.js';

test('chapter navigation settings sort choices alphabetically without reordering project data',()=>{
 const project=createProject(),z=project.chapters[0];z.name='Zebra';
 const a=createChapter('alpha','Alpha'),m=createChapter('middle','Middle');project.chapters.push(a,m);
 project.startChapterId=m.id;z.nextChapterId=a.id;
 const before=structuredClone(project);
 const settings=projectSettingsInspector(project),chapterSettings=chapterSettingsInspector(project,z);
 const options=html=>html.slice(html.indexOf('<select data-scope='),html.indexOf('</select>'));
 const start=options(settings.slice(settings.indexOf('Start chapter'))),next=options(chapterSettings.slice(chapterSettings.indexOf('Next chapter')));
 for(const html of [start,next])assert.ok(html.indexOf('Alpha')<html.indexOf('Middle')&&html.indexOf('Middle')<html.indexOf('Zebra'));
 assert.match(start,/<option value="middle" selected>Middle/);assert.match(next,/<option value="alpha" selected>Alpha/);
 assert.match(next,/None · End game/);
 assert.ok(settings.indexOf('Start chapter')>settings.indexOf('Card text styles'));
 assert.ok(settings.indexOf('Play from the start')>settings.indexOf('Start chapter'));
 assert.match(settings,/data-command="play-from-start" class="play-from-start"/);
 assert.deepEqual(project,before);
});
