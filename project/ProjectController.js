import { initialValues, conditionsMet, affordCosts, transact, addInventory } from './state.js';
import { cardBody, cardFace } from './presentation.js';
import { cardSummary, isStoryKind } from './cards.js';
import { selectPool } from '../chapter/random.js';

/** Playback only. CardDeck remains responsible for gestures and departure choreography. */
export class ProjectController {
  constructor(deck, compiled, {onChange=()=>{},rng=Math.random,rollCheck,onCheckResult=()=>{},onError=()=>{}} = {}) {
    this.deck=deck; this.compiled=compiled; this.nodes=new Map(compiled.nodes.map(n=>[n.id,n]));
    Object.assign(this,{onChange,rng,rollCheck,onCheckResult,onError});
    this.generation=0; this.serial=0; this.destroyed=false;
    this.listeners={reveal:e=>this.reveal(e.detail),commit:e=>this.commit(e.detail),collect:e=>this.resolveItem(e.detail,'collect'),discard:e=>this.resolveItem(e.detail,'discard'),transitioncomplete:e=>this.transitionComplete(e.detail)};
    for(const [name,listener] of Object.entries(this.listeners)) deck.addEventListener(name,listener);
    this.restart();
  }
  get state() { return {activeNodeId:this.location?.node.id ?? null,cardId:this.card()?.id ?? null,variables:{...this.variables},collectedItems:this.inventory.map(i=>({...i})),completed:this.completed,checking:!!this.checking,idle:!this.completed&&!this.checking&&!this.pendingItem&&!this.pendingIntro&&!this.deck.busy&&!this.deck.drag&&!['revealing','closing','committing','collecting'].includes(this.deck.phase)}; }
  notify() {if(!this.destroyed)this.onChange(this.state);}
  error(error) {if(!this.destroyed)this.onError(error,this.state);}
  restart() {
    if(this.destroyed)return;
    ++this.generation; this.checking?.abort(); this.checking=null;
    this.deck.reset(); this.variables=initialValues(this.compiled.variables); this.inventory=[];
    this.remaining=new Map(); this.accepted=new Set();this.revealedIntros=new Set();this.pendingIntro=null; this.pendingItem=null;this.stagedDestination=null;this.completed=false;
    try {this.adopt(this.locate(this.compiled.startNode),false);this.show();} catch(error){
      if(error.message==='Unlinked output') {
        this.location=null;this.completed=false;
        this.deck.replaceContent({id:`${this.generation}:${++this.serial}`,title:'Unlinked output',actions:[{id:'unavailable',label:'Unlinked output',disabled:true}],decisionOnly:true},{presentation:'open',animate:false});
      }else {this.completed=true;this.deck.endContent();}
      this.error(error);this.notify();
    }
  }
  type(location=this.location) {return location?.sequence?.type ?? location?.node.type;}
  card(location=this.location) {
    if(!location)return null;
    const type=this.type(location);
    if(type==='container')return location.sequence?.cards?.[0] ?? location.node.intro ?? null;
    if(type==='fork')return location.node.intro ?? null;
    return (location.sequence?.cards ?? location.node.cards ?? [])[location.index];
  }
  choices(location=this.location) {return location.sequence?.cards?.[location.index]?.choices ?? location.node.choices ?? [];}
  key(location=this.location) {return `${location.node.id}:${location.sequence?.id ?? ''}`;}
  introEnabled(location=this.location) {return location.node.type==='fork'?!!location.node.intro&&location.node.introEnabled!==false:location.node.type!=='container'||location.node.introEnabled!==false;}
  introShown(location=this.location) {return location.introRevealed===true || location.node.introOnce===true&&this.revealedIntros.has(this.key(location));}
  items(location=this.location, values=this.variables, inventory=this.inventory, excluded=null) {
    if(excluded?.all&&excluded.key===this.key(location))return [];
    const raw=this.remaining.get(this.key(location)) ?? location.sequence?.items ?? location.node.items ?? [];
    return raw.filter(i=>i.id!==excluded && conditionsMet(i.conditions,values,inventory));
  }
  weighted(routes) {
    const total=routes.reduce((sum,r)=>sum+r.weight,0); if(!total)return null;
    const draw=this.rng();if(!Number.isFinite(draw)||draw<0||draw>=1)throw new TypeError('Random source must return 0 ≤ n < 1');
    let ticket=draw*total;
    return routes.find(r=>(ticket-=r.weight)<0) ?? routes.at(-1);
  }
  locate(id,values=this.variables,inventory=this.inventory,visited=new Set(),excluded=null,preview=false,preflight=null) {
    if(id===null)return {completed:true};
    if(id===false||id===undefined)throw new Error('Unlinked output');
    // Share completed results only within this prediction, while keeping the
    // current DFS path separate so reconvergence cannot hide routing cycles.
    if(preview) {
      if(!preflight||preflight.values!==values||preflight.inventory!==inventory||preflight.excluded!==excluded)preflight={values,inventory,excluded,visiting:new Set(visited),completed:new Map()};
      visited=preflight.visiting;
      if(visited.has(id))throw new Error('Automatic routing cycle');
      if(preflight.completed.has(id))return preflight.completed.get(id);
    }
    if(visited.has(id))throw new Error('Automatic routing cycle'); visited.add(id);
    try {
      const node=this.nodes.get(id);if(!node)throw new Error(`Unknown node: ${id}`);
      let result;
      if(node.type==='random') {
        const routes=(node.routes ?? []).filter(r=>r.weight>0 && conditionsMet(r.conditions,values,inventory));
        if(preview) {
          const targets=routes.length?routes.map(r=>r.target):[node.fallback];
          for(const target of targets)this.locate(target,values,inventory,visited,excluded,true,preflight);
          result=null;
        }else {
          const selected=this.weighted(routes);
          return this.locate(selected ? selected.target : node.fallback,values,inventory,visited,excluded,preview);
        }
      }else if(node.type==='legacyPool'&&preview) {
        result=null;
      }else {
        let location={node,index:0,queue:[]};
        if(node.type==='legacySequence')location.sequence=node.sequence;
        if(node.type==='legacyPool') {
          location.queue=selectPool(node.pool,node.count,this.rng);
          location.sequence=node.sequences.find(s=>s.id===location.queue.shift());
          if(!location.sequence)return this.locate(node.connections?.next,values,inventory,visited,excluded,preview);
        }
        result=this.seek(location,values,inventory,visited,excluded,preview,preflight);
      }
      if(preview)preflight.completed.set(id,result);
      return result;
    }finally {if(preview)visited.delete(id);}
  }
  seek(location,values=this.variables,inventory=this.inventory,visited=new Set(),excluded=null,preview=false,preflight=null) {
    const type=this.type(location);
    if(type==='linear') {
      const cards=location.sequence?.cards ?? location.node.cards ?? [];
      while(location.index<cards.length) {
        const card=cards[location.index];
        const hiddenAction=card.kind==='action'&&card.unavailable==='hidden'&&!affordCosts(values,inventory,card.costs,this.compiled.variables);
        if(conditionsMet(card.conditions,values,inventory)&&!hiddenAction)break;
        location={...location,index:location.index+1};
      }
      if(location.index>=cards.length)return this.next(location,'next',values,inventory,visited,excluded,preview,preflight);
    } else if(type==='container' && !this.items(location,values,inventory,excluded).length && !(location.node.type==='container'&&this.introEnabled(location)&&!this.introShown(location)&&conditionsMet(this.card(location)?.conditions,values,inventory)&&this.card(location)?.effects?.length)) return this.next(location,'next',values,inventory,visited,excluded,preview,preflight);
    return location;
  }
  next(location,output='next',values=this.variables,inventory=this.inventory,visited=new Set(),excluded=null,preview=false,preflight=null) {
    if(location.queue?.length) {
      const queue=[...location.queue];const id=queue.shift();
      return this.seek({...location,sequence:location.node.sequences.find(s=>s.id===id),queue,index:0},values,inventory,visited,excluded,preview,preflight);
    }
    const key=location.node.type==='legacyPool'?'next':output;
    return this.locate(location.node.connections?.[key],values,inventory,visited,excluded,preview,preflight);
  }
  destination(source,success,values=this.variables,inventory=this.inventory,location=this.location,preview=false) {
    const type=this.type(location);
    if(type==='linear') {
      return this.seek({...location,index:location.index+1},values,inventory,new Set(),null,preview);
    }
    if(location.sequence && type==='forked') {
      const target=source.target;
      if(target?.startsWith('card:'))return {...location,index:location.sequence.cards.findIndex(c=>c.id===target.slice(5))};
      return this.next(location,target?.slice(5) ?? source.id,values,inventory,new Set(),null,preview);
    }
    const output=source.resolution==='check'?`${source.id}:${success?'success':'failure'}`:source.id;
    return this.next(location,output,values,inventory,new Set(),null,preview);
  }
  departureBlocked(source,location=this.location,values=this.variables,inventory=this.inventory,transition=null,excludedItem=null) {
    try {
      const outcomes=source.resolution==='check'?[true,false]:[undefined];
      for(const outcome of outcomes) {
        const collected=transition==='collect'?addInventory(inventory,{...source,text:this.body(source)}):inventory;
        const result=transact(values,collected,{costs:transition?[]:source.costs,effects:transition?(transition==='collect'?(source.onCollect??source.effects??[]):[]):[...(source.effects??[]),...(outcome===undefined?[]:outcome?source.successEffects??[]:source.failureEffects??[])]},this.compiled.variables,this.compiled.library);
        if(this.type(location)==='container') {
          if(transition==='collect'&&this.items(location,result.variables,result.inventory,excludedItem).some(i=>i.id!==source.id))continue;
          this.next(location,'next',result.variables,result.inventory,new Set(),transition==='discard'?{key:this.key(location),all:true}:source.id,true);
        }else this.destination(source,outcome,result.variables,result.inventory,location,true);
      }
      return false;
    }catch(error) {
      // Transaction errors retain their existing runtime error/retry behavior.
      return error.message==='Unlinked output'||error.message==='Automatic routing cycle'||error.message.startsWith('Unknown node:');
    }
  }
  adopt(destination,notify=true) {this.completed=!!destination.completed;if(!this.completed)this.location=destination;if(notify)this.notify();}
  body(card) {return cardBody(card);}
  action(card) {const {context,...content}=card;const typed={...card,kind:card.kind ?? (this.type()==='container'?'item':'action')};return {...content,label:card.name ?? card.label ?? 'Continue',...cardFace(typed,this.compiled.variables,this.compiled.library)};}
  linearTransition(location, destination, source=this.card(location)) {
    return this.type(location)==='linear'&&!['action','item'].includes(source?.kind)&&destination&&!destination.completed&&this.key(location)===this.key(destination)&&destination.index>location.index?'reveal':'flip';
  }
  content(location=this.location,values=this.variables,inventory=this.inventory,preview=true,excludedItem=null) {
    const type=this.type(location),card=this.card(location),fork=type==='fork'||type==='forked',container=type==='container',linearFace=type==='linear'&&['action','item'].includes(card?.kind),linearItem=linearFace&&card.kind==='item';
    let actions;
    if(fork)actions=this.choices(location).flatMap(c=>{
      if(c.contextItemId&&!conditionsMet([{source:'inventory',key:c.contextInventoryKey ?? c.contextItemId,op:'has'}],values,inventory))return [];
      const available=conditionsMet(c.conditions,values,inventory)&&affordCosts(values,inventory,c.costs,this.compiled.variables);
      return !available&&c.unavailable==='hidden'?[]:[{...this.action(c),disabled:!available||this.departureBlocked(c,location,values,inventory)}];
    });
    else if(container)actions=this.items(location,values,inventory,excludedItem).map(c=>({...this.action(c),discardDisabled:this.departureBlocked(c,location,values,inventory,'discard',excludedItem),collectDisabled:this.departureBlocked(c,location,values,inventory,'collect',excludedItem)}));
    else if(linearFace)actions=[{...this.action(card),disabled:!conditionsMet(card.conditions,values,inventory)||!affordCosts(values,inventory,card.kind==='action'?card.costs:[],this.compiled.variables)}];
    else actions=[{id:'continue',label:'Continue',image:card?.image,flipImage:!!card?.flipImage}];
    if(linearFace) {
      if(linearItem)Object.assign(actions[0],{discardDisabled:this.departureBlocked(card,location,values,inventory,'discard'),collectDisabled:this.departureBlocked(card,location,values,inventory,'collect')});
      else actions[0].disabled ||= this.departureBlocked(card,location,values,inventory);
    }
    if(container||linearItem)for(const action of actions)action.disabled ||= action.collectDisabled&&action.discardDisabled;
    if(!actions.length)actions=[{id:'unavailable',label:'No available choices',disabled:true}];
    const payload={autoBrowse:fork||container,id:`${this.generation}:${++this.serial}`,backImage:this.compiled.backImage ?? '',title:card?.name ?? card?.title ?? '',heading:cardFace(card,this.compiled.variables,this.compiled.library).heading,text:this.body(card),cardKind:card?.kind ?? 'event',summary:card&&!isStoryKind(card.kind??card.cardKind)&&fork?cardSummary(card,this.compiled.variables,this.compiled.library):'',image:card?.image ?? '',imageScale:card?.imageScale??100,imageOffsetX:card?.imageOffsetX??0,imageOffsetY:card?.imageOffsetY??0,flipImage:!!card?.flipImage,actions,directAdvance:!fork&&!container&&!linearFace,decisionOnly:linearFace||fork&&(location.sequence?!!location.sequence.decisionOnly:this.presentation(location,values,inventory)==='open'),interaction:container||linearItem?'container':'choice',discardAll:container,allowClose:false};
    if(fork)payload.choiceFollowerRatio=.82;
    payload.flipItemsOnReveal=container&&this.presentation(location,values,inventory)==='closed';
    if(payload.directAdvance){payload.nextTransition='flip';payload.advanceDisabled=this.departureBlocked(card,location,values,inventory);actions[0].disabled=payload.advanceDisabled;}
    if(type==='linear'&&preview&&card&&card.kind!=='item'&&card.resolution!=='check') {
      try {
        const predicted=transact(values,inventory,{costs:card.costs,effects:card.effects},this.compiled.variables,this.compiled.library);
        const next=this.seek({...location,index:location.index+1},predicted.variables,predicted.inventory,new Set(),null,true);
        payload.nextTransition=this.linearTransition(location,next,card);
        if(next&&!next.completed) {
          const nextContent=this.content(next,predicted.variables,predicted.inventory,false);
          payload.nextDeckPreview={content:nextContent,presentation:this.presentation(next,predicted.variables,predicted.inventory)};
          if(this.type(next)==='linear')payload.nextCardPreview={title:nextContent.title,heading:nextContent.heading,text:nextContent.text,image:nextContent.image,imageScale:nextContent.imageScale,imageOffsetX:nextContent.imageOffsetX,imageOffsetY:nextContent.imageOffsetY,flipImage:nextContent.flipImage,cardKind:nextContent.cardKind};
        }
      }catch { /* An invalid transaction must never leak a speculative successor. */ }
    }
    return payload;
  }
  presentation(location=this.location,values=this.variables,inventory=this.inventory) {
    const type=this.type(location);
    if(type==='linear'&&['action','item'].includes(this.card(location)?.kind))return 'open';
    if(type==='fork')return this.introEnabled(location)&&!this.introShown(location)&&conditionsMet(this.card(location)?.conditions,values,inventory)?'closed':'open';
    if(type==='forked')return location.sequence.decisionOnly?'open':'closed';
    if(type==='container'&&(!this.introEnabled(location)||this.introShown(location)||!conditionsMet(this.card(location)?.conditions,values,inventory)))return 'open';
    return 'closed';
  }
  reportBlocked(content=this.deck.content) {
    if((['fork','forked'].includes(this.type())||this.type()==='linear'&&this.card()?.kind==='action')&&this.presentation()==='open'&&!content.actions.some(a=>!a.disabled))this.error(new Error(`No available choices at ${this.location.node.name || this.location.node.id}. Check choice requirements and costs, use an eligible inventory item, or restart.`));
  }
  show({transition='flip',restore=false,presentation,animate=true,autoBrowse=true}={}) {
    if(this.completed){this.deck.endContent();if(!this.deck.busy)this.deck.completeCommit?.();this.notify();return;}
    if(restore)this.deck.reset();
    if(this.type()==='container'&&!conditionsMet(this.card()?.conditions,this.variables,this.inventory)){this.location.introRevealed=true;this.revealedIntros.add(this.key());}
    const content=this.content();
    content.autoBrowse=content.autoBrowse&&autoBrowse;
    this.deck.replaceContent(content,{presentation:presentation ?? this.presentation(),transition,animate});this.reportBlocked(content);this.notify();
  }
  reveal(detail) {
    if(this.destroyed||this.completed||this.checking||this.pendingItem||this.pendingIntro||!['container','fork'].includes(this.location.node.type)||!this.introEnabled()||detail.contentId!==this.deck.content.id||this.introShown())return;
    const intro=this.card();
    if(!conditionsMet(intro?.conditions,this.variables,this.inventory))return;
    try {
      const result=transact(this.variables,this.inventory,{effects:intro?.effects},this.compiled.variables,this.compiled.library);
      this.location.introRevealed=true;this.revealedIntros.add(this.key());this.pendingIntro={contentId:detail.contentId};
      this.variables=result.variables;this.inventory=result.inventory;
      if(this.type()==='container'&&this.deck.commitMotion?.introduction) {
        const content=this.content();content.id=detail.contentId;
        this.deck.replaceContent(content,{presentation:'open',transition:'flip'});
      }
      this.notify();
    }catch(error){this.error(error);this.show({restore:true});}
  }
  transaction(source,outcome) {return transact(this.variables,this.inventory,{costs:source.costs,effects:[...(source.effects??[]),...(outcome===undefined?[]:outcome?source.successEffects??[]:source.failureEffects??[])]},this.compiled.variables,this.compiled.library);}
  available(source) {return conditionsMet(source.conditions,this.variables,this.inventory)&&affordCosts(this.variables,this.inventory,source.costs,this.compiled.variables);}
  commit(detail) {
    if(this.destroyed||this.completed||this.checking||this.pendingItem||this.pendingIntro||(this.type()==='container'||this.type()==='linear'&&this.card()?.kind==='item')||detail.contentId!==this.deck.content.id||this.accepted.has(detail.contentId))return;
    const action=this.deck.content.actions.find(a=>a.id===detail.action?.id&&!a.disabled);if(!action)return;
    const source=['fork','forked'].includes(this.type())?this.choices().find(c=>c.id===action.id):this.card();
    if(!source||!this.available(source)||this.departureBlocked(source)){this.show({restore:true});return;}
    this.accepted.add(detail.contentId);
    if(source.resolution==='check'){this.runCheck(source);return;}
    try {
      const result=this.transaction(source);const destination=this.destination(source,undefined,result.variables,result.inventory);
      this.variables=result.variables;this.inventory=result.inventory;const transition=this.linearTransition(this.location,destination,source);
      this.adopt(destination,false);this.show({transition});
    }catch(error){this.error(error);this.show({restore:true});}
  }
  async runCheck(source) {
    if(this.departureBlocked(source))return;
    const generation=this.generation,abort=new AbortController();this.checking=abort;this.notify();
    try {
      if(!this.rollCheck)throw new Error('No dice roller supplied');
      const result=await this.rollCheck(source.check.pool,{signal:abort.signal});
      if(abort.signal.aborted||generation!==this.generation||this.destroyed)return;
      const dice=Array.isArray(result)?result:result?.dice;
      const raw=typeof result==='number'?result:Array.isArray(dice)?dice.reduce((sum,d)=>sum+(typeof d==='number'?d:d.value),0):result?.total;
      if(!Number.isFinite(raw))throw new TypeError('Invalid dice result');
      const modifier=(source.check.modifier??0)+(source.check.modifierVariable?this.variables[source.check.modifierVariable]:0);
      if(!Number.isFinite(modifier))throw new TypeError('Invalid check modifier');
      const total=raw+modifier,success=total>=source.check.target;
      await this.onCheckResult({total,target:source.check.target,success,dice:dice??[],signal:abort.signal});
      if(abort.signal.aborted||generation!==this.generation||this.destroyed)return;
      if(this.departureBlocked(source))throw new Error('Unlinked output');
      if(!this.available(source))throw new Error('Check requirements changed');
      const next=this.transaction(source,success);const destination=this.destination(source,success,next.variables,next.inventory);
      this.variables=next.variables;this.inventory=next.inventory;this.checking=null;this.adopt(destination,false);this.show();
    }catch(error){
      if(generation!==this.generation||this.destroyed)return;
      this.checking=null;if(error?.name!=='AbortError')this.error(error);this.show({restore:true});
    }
  }
  cancelCheck() {if(!this.checking)return false;this.checking.abort();this.checking=null;++this.generation;this.show({restore:true});return true;}
  resolveItem(detail,transition) {
    const linearItem=this.type()==='linear'&&this.card()?.kind==='item';
    const all=transition==='discard'&&detail.all===true&&!linearItem;
    if(this.destroyed||this.completed||this.checking||this.pendingItem||this.pendingIntro||(!linearItem&&this.type()!=='container')||detail.contentId!==this.deck.content.id)return;
    const item=linearItem?this.card():this.items().find(i=>i.id===detail.action?.id);
    if(!item||item.id!==detail.action?.id||!conditionsMet(item.conditions,this.variables,this.inventory))return;
    if(this.departureBlocked(item,this.location,this.variables,this.inventory,transition)){this.show({restore:true});return;}
    try {
      const {context,...itemContent}=item;
      const inventory=transition==='collect'?addInventory(this.inventory,{...itemContent,text:this.body(item)}):this.inventory;
      const result=transact(this.variables,inventory,{effects:transition==='collect'?(item.onCollect??item.effects??[]):[]},this.compiled.variables,this.compiled.library);
      this.pendingItem={item,key:this.key(),linearItem,all,transition,contentId:detail.contentId,result};
      if(detail.final||linearItem||all) {
        const retainContainer=!linearItem&&!all&&this.items(this.location,result.variables,result.inventory,item.id).length>0;
        const excluded=all?{key:this.key(),all:true}:item.id;
        this.stagedDestination=linearItem?this.destination(item,undefined,result.variables,result.inventory):retainContainer?this.location:this.next(this.location,'next',result.variables,result.inventory,new Set(),excluded);
        if(this.stagedDestination.completed)this.deck.endContent();
        else {
          const content=this.content(this.stagedDestination,result.variables,result.inventory,true,retainContainer?item.id:null);
          if(retainContainer)content.autoBrowse=false;
          this.deck.replaceContent(content,{presentation:retainContainer?'open':this.presentation(this.stagedDestination,result.variables,result.inventory),transition:'flip'});
        }
      }
    }catch(error){this.pendingItem=null;this.stagedDestination=null;this.error(error);this.show({restore:true});}
  }
  transitionComplete(detail) {
    if(this.destroyed)return;
    if(this.pendingIntro&&detail.transition==='reveal'&&detail.contentId===this.pendingIntro.contentId) {
      this.pendingIntro=null;
      try {
        if(this.type()==='container'&&!this.items().length){
          if(this.departureBlocked(this.card()??{},this.location,this.variables,this.inventory,'discard'))this.show({presentation:'open',animate:false});
          else {this.adopt(this.next(this.location),false);this.show();}
        }
        else {
          const updated=this.content();
          if(JSON.stringify(this.deck.content.actions)!==JSON.stringify(updated.actions)) {
            if(this.location.node.type==='fork'&&typeof this.deck.updateActions==='function'&&this.deck.updateActions(updated.actions)!==false){this.reportBlocked();this.notify();}
            else this.show({presentation:'open',animate:false});
          }
          else {this.reportBlocked();this.notify();}
        }
      }catch(error){this.error(error);this.notify();}
      return;
    }
    const pending=this.pendingItem;
    if(pending&&detail.transition===pending.transition&&detail.contentId===pending.contentId) {
      if(!pending.linearItem) {
        const raw=this.remaining.get(pending.key)??this.location.sequence?.items??this.location.node.items??[];
        this.remaining.set(pending.key,pending.all?[]:raw.filter(i=>i.id!==pending.item.id));
      }
      this.variables=pending.result.variables;this.inventory=pending.result.inventory;this.pendingItem=null;this.notify();
      if(!this.stagedDestination) {
        if(!this.items().length){this.adopt(this.next(this.location),false);this.show();}
        else {
          const visible=this.items().map(i=>i.id),shown=this.deck.content.actions.map(a=>a.id);
          const updated=this.content();
          if(visible.length!==shown.length||visible.some(id=>!shown.includes(id))||updated.actions.some(a=>{const old=this.deck.content.actions.find(c=>c.id===a.id);return old?.collectDisabled!==a.collectDisabled||old?.discardDisabled!==a.discardDisabled;}))this.show({presentation:'open',animate:false,autoBrowse:false});
        }
      }
    }else if(detail.transition==='commit'&&this.stagedDestination){const destination=this.stagedDestination;this.stagedDestination=null;this.adopt(destination);if(!this.completed)this.reportBlocked();}
    else this.notify();
  }
  useItem(definitionId) {
    if(this.destroyed||this.completed||this.checking||this.pendingItem||this.pendingIntro||this.deck.busy||this.deck.drag||['revealing','closing','committing','collecting'].includes(this.deck.phase))return false;
    if(this.location.node.type==='fork'&&typeof this.deck.updateActions==='function'&&!['closed','choices'].includes(this.deck.phase))return false;
    const item=this.inventory.find(i=>i.definitionId===definitionId||i.inventoryKey===definitionId||i.id===definitionId);
    if(!item?.use||!conditionsMet(item.use.conditions,this.variables,this.inventory))return false;
    try {
      const result=transact(this.variables,this.inventory,{costs:[{source:'inventory',key:definitionId,amount:1}],effects:item.use.effects},this.compiled.variables,this.compiled.library);
      const previous=this.location,destination=this.seek(this.location,result.variables,result.inventory);
      this.variables=result.variables;this.inventory=result.inventory;
      this.adopt(destination,false);
      if(!this.completed&&previous.node.type==='fork'&&this.location.node===previous.node&&typeof this.deck.updateActions==='function'&&this.deck.updateActions(this.content().actions)!==false) {
        this.reportBlocked();this.notify();
      }else this.show({restore:true});
      return true;
    }catch(error){this.error(error);return false;}
  }
  destroy() {if(this.destroyed)return;this.destroyed=true;++this.generation;this.checking?.abort();this.checking=null;for(const [name,listener]of Object.entries(this.listeners))this.deck.removeEventListener(name,listener);}
}
