/** Visibility-paused result delays only. Card movement belongs to CardDeck. */
export class PresentationDelay {
 constructor(doc=document){this.doc=doc;this.revision=0;this.jobs=new Set();this.visibility=()=>this.sync();doc.addEventListener('visibilitychange',this.visibility);}
 sync(){for(const job of this.jobs){if(this.doc.hidden){if(job.timer){clearTimeout(job.timer);job.remaining=Math.max(0,job.remaining-(performance.now()-job.started));job.timer=null;}}else if(!job.timer){job.started=performance.now();job.timer=setTimeout(()=>{this.jobs.delete(job);job.resolve(true);},job.remaining);}}}
 wait(ms,revision=this.revision){if(revision!==this.revision)return Promise.resolve(false);return new Promise(resolve=>{this.jobs.add({remaining:ms,resolve,timer:null});this.sync();});}
 cancel(){this.revision++;for(const job of this.jobs){clearTimeout(job.timer);job.resolve(false);}this.jobs.clear();}
 destroy(){this.cancel();this.doc.removeEventListener('visibilitychange',this.visibility);}
}
