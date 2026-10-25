/** Cancelable, visibility-paused presentation time. */
export class PresentationClock {
 constructor(doc=document){this.doc=doc;this.revision=0;this.jobs=new Set();this.animations=new Set();this.visibility=()=>this.sync();doc.addEventListener('visibilitychange',this.visibility);}
 sync(){for(const job of this.jobs){if(this.doc.hidden){if(job.timer){clearTimeout(job.timer);job.remaining=Math.max(0,job.remaining-(performance.now()-job.started));job.timer=null;}}else if(!job.timer){job.started=performance.now();job.timer=setTimeout(()=>{this.jobs.delete(job);job.resolve(true);},job.remaining);}}for(const animation of this.animations)this.doc.hidden?animation.pause():animation.play();}
 wait(ms,revision=this.revision){if(revision!==this.revision)return Promise.resolve(false);return new Promise(resolve=>{this.jobs.add({remaining:ms,resolve,timer:null});this.sync();});}
 async animate(element,frames,options){const revision=this.revision;const a=element.animate(frames,{...options,fill:'forwards'});this.animations.add(a);if(this.doc.hidden)a.pause();const ok=await this.wait(options.duration,revision);this.animations.delete(a);a.cancel();return ok;}
 cancel(){this.revision++;for(const j of this.jobs){clearTimeout(j.timer);j.resolve(false);}this.jobs.clear();for(const a of this.animations)a.cancel();this.animations.clear();}
 destroy(){this.cancel();this.doc.removeEventListener('visibilitychange',this.visibility);}
}
