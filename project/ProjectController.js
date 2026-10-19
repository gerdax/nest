import { retainsInventoryItems } from './nodeTypes.js';
import { initialValues, conditionsMet, affordCosts, transact, addInventory, canTriggerItem } from './state.js';
import { cardBody, cardFace } from './presentation.js';
import { playerCardSummary, isStoryKind, collectionEffects } from './cards.js';
import { selectPool } from '../chapter/random.js';
import { isInventoryContext } from '../engine/inventoryContext.js';
import { resolveCheck, playerCheckPresentation } from './checks.js';

/** Playback only. CardDeck remains responsible for gestures and departure choreography. */
export class ProjectController {
  constructor(deck, compiled, {onChange=()=>{},rng=Math.random,rollCheck,onCheckResult=()=>{},onError=()=>{},initialState} = {}) {
    this.deck=deck; this.compiled=compiled; this.nodes=new Map(compiled.nodes.map(n=>[n.id,n]));
    Object.assign(this,{onChange,rng,rollCheck,onCheckResult,onError});
    this.initialState = initialState ? structuredClone(initialState) : null;
    this.generation=0; this.serial=0; this.destroyed=false;
    this.listeners={reveal:e=>this.reveal(e.detail),commit:e=>this.commit(e.detail),collect:e=>this.resolveItem(e.detail,'collect'),discard:e=>this.resolveItem(e.detail,'discard'),transitioncomplete:e=>this.transitionComplete(e.detail)};
    for(const [name,listener] of Object.entries(this.listeners)) deck.addEventListener(name,listener);
    this.restart();
  }
  get state() { return {activeNodeId:this.location?.node.id ?? null,cardId:this.card()?.id ?? null,variables:{...this.variables},collectedItems:this.inventory.map(i=>({...i})),completed:this.completed,checking:!!this.checking,idle:!this.completed&&!this.checking&&!this.pendingItem&&!this.pendingIntro&&!this.deck.busy&&!this.deck.pickup?.pending&&!this.deck.drag&&!['revealing','closing','committing','collecting'].includes(this.deck.phase)}; }
  notify() {if(!this.destroyed)this.onChange(this.state);}
  error(error) {if(!this.destroyed)this.onError(error,this.state);}
  restart() {
    if(this.destroyed)return;
    ++this.generation; this.checking?.abort(); this.checking=null;
    this.deck.reset();
    this.variables=transact(initialValues(this.compiled.variables),[],{effects:Object.entries(this.initialState?.variables || {}).map(([key,value])=>({op:'set',key,value}))},this.compiled.variables).variables;
    this.inventory=(this.initialState?.inventory || []).reduce((items,item)=>addInventory(items,structuredClone(item)),[]);
    this.remaining=new Map(); this.itemReplacements=new Map(); this.accepted=new Set();this.revealedIntros=new Set();this.pendingIntro=null; this.pendingItem=null;this.pendingExchange=null;this.stagedDestination=null;this.completed=false;
    this.location=null;
    try {this.adopt(this.locate(this.compiled.startNode),false);this.show();} catch(error){
      this.location=null;this.completed=false;
      const message=error.message==='Unlinked output'?'Unlinked output':'Playback blocked';
      this.deck.replaceContent({id:`${this.generation}:${++this.serial}`,title:message,actions:[{id:'unavailable',label:message,disabled:true}],decisionOnly:true},{presentation:'open',animate:false});
      this.error(error);this.notify();
    }
  }
  type(location=this.location) {return location?.sequence?.type ?? location?.node.type;}
  ownsItem(item, inventory=this.inventory) {
    return inventory.some(owned => (owned.definitionId ?? owned.id) === (item.definitionId ?? item.id)
      || item.inventoryKey != null && owned.inventoryKey === item.inventoryKey);
  }
  hidesOwnedItem(item, inventory=this.inventory, location=null) {
    return this.compiled.ownedItemsVisibility === 'hidden' && this.ownsItem(item, inventory)
      && (this.type(location)!=='container' || this.ownsItem(item,location.ownedItemsAtEntry ?? inventory));
  }
  runtimeItem(card, location=this.location) {
    return this.itemReplacements.get(this.key(location))?.get(card?.id) ?? card;
  }
  card(location=this.location) {
    if(!location)return null;
    const type=this.type(location);
    if(type==='container')return location.sequence?.cards?.[0] ?? location.node.intro ?? null;
    if(type==='fork')return location.node.intro ?? null;
    return this.runtimeItem((location.sequence?.cards ?? location.node.cards ?? [])[location.index],location);
  }
  choices(location=this.location) {return location.sequence?.cards?.[location.index]?.choices ?? location.node.choices ?? [];}
  key(location=this.location) {return `${location.node.id}:${location.sequence?.id ?? ''}`;}
  introEnabled(location=this.location) {return location.node.type==='fork'?!!location.node.intro&&location.node.introEnabled!==false:location.node.type!=='container'||location.node.introEnabled!==false;}
  introShown(location=this.location) {return location.introRevealed===true || location.node.introOnce===true&&this.revealedIntros.has(this.key(location));}
  discardedReturns(location=this.location, source=null) {
    if(retainsInventoryItems(location.sequence ?? location.node))return [];
    const ids=[...(this.itemReplacements.get(this.key(location))?.keys() ?? [])];
    return this.type(location)==='linear'?ids.filter(id=>id===source?.id):ids;
  }
  itemExcluded(id,location,excluded) {
    const key=this.key(location),pending=this.pendingItem;
    return this.type(location)==='container'&&id===excluded || excluded?.key===key&&(excluded.itemId===id||excluded.itemIds?.includes(id)||excluded.all)
      || pending?.key===key&&pending.removedIds?.includes(id);
  }
  linearItemRemaining(card,location,excluded) {
    if(card.kind!=='item')return true;
    const key=this.key(location),pending=this.pendingItem;
    // Staged successors exclude a collected item before ownership commits.
    // Discard only advances this visit; the item stays available on return.
    if(this.itemExcluded(card.id,location,excluded)||(pending?.linearItem&&pending.transition==='collect'&&pending.key===key&&pending.item.id===card.id))return false;
    const remaining=this.remaining.get(key);
    return !remaining||remaining.some(item=>item.id===card.id);
  }
  items(location=this.location, values=this.variables, inventory=this.inventory, excluded=null) {
    if(excluded?.all&&excluded.key===this.key(location))return [];
    const raw=this.remaining.get(this.key(location)) ?? location.sequence?.items ?? location.node.items ?? [];
    return raw.map(i=>this.runtimeItem(i,location)).filter(i=>!this.itemExcluded(i.id,location,excluded) && conditionsMet(i.conditions,values,inventory) && !this.hidesOwnedItem(i,inventory,location));
  }
  weighted(routes) {
    if(!routes.length)return null;
    const maximum=routes.reduce((max,r)=>Math.max(max,r.weight),0);
    const total=routes.reduce((sum,r)=>sum+r.weight/maximum,0);
    const draw=this.rng();if(!Number.isFinite(draw)||draw<0||draw>=1)throw new TypeError('Random source must return 0 ≤ n < 1');
    let ticket=draw*total;
    return routes.find(r=>(ticket-=r.weight/maximum)<0) ?? routes.at(-1);
  }
  locate(id,values=this.variables,inventory=this.inventory,visited=new Set(),excluded=null,preview=false,preflight=null) {
    return this.traverse({id},values,inventory,visited,excluded,preview,preflight);
  }
  // Explicit DFS frames keep long automatic paths off the JavaScript call stack.
  // Preview explores every eligible Random branch without drawing randomness.
  traverse(start,values,inventory,visited,excluded,preview,preflight) {
    if(preview) {
      if(!preflight||preflight.values!==values||preflight.inventory!==inventory||preflight.excluded!==excluded)preflight={values,inventory,excluded,visiting:new Set(visited),completed:new Map()};
      visited=preflight.visiting;
    }
    const pending=[start],entered=new Set();
    let result;
    try {
      while(pending.length) {
        const step=pending.pop();
        if(step.finish) {
          if(step.random)result=null;
          if(preview){preflight.completed.set(step.id,result);visited.delete(step.id);entered.delete(step.id);}
          continue;
        }
        if(step.location) {
          const next=this.seekStep(step.location,values,inventory,excluded);
          if(next.ready)result=next.location;
          else pending.push(next);
          continue;
        }
        const id=step.id;
        if(id===null){result={completed:true};continue;}
        if(id===false||id===undefined)throw new Error('Unlinked output');
        if(visited.has(id))throw new Error('Automatic routing cycle');
        if(preview&&preflight.completed.has(id)){result=preflight.completed.get(id);continue;}
        visited.add(id);entered.add(id);
        const node=this.nodes.get(id);if(!node)throw new Error(`Unknown node: ${id}`);
        pending.push({finish:true,id,random:preview&&node.type==='random'});
        if(node.type==='random') {
          const routes=(node.routes ?? []).filter(r=>r.weight>0&&conditionsMet(r.conditions,values,inventory));
          if(preview) {
            const targets=routes.length?routes.map(r=>r.target):[node.fallback];
            for(let i=targets.length-1;i>=0;i--)pending.push({id:targets[i]});
          }else {
            const selected=this.weighted(routes);
            pending.push({id:selected?selected.target:node.fallback});
          }
        }else if(node.type==='legacyPool'&&preview)result=null;
        else {
          const location={node,index:0,queue:[]};
          if(node.type==='legacySequence')location.sequence=node.sequence;
          if(node.type==='legacyPool') {
            location.queue=selectPool(node.pool,node.count,this.rng);
            location.sequence=node.sequences.find(s=>s.id===location.queue.shift());
            if(!location.sequence){pending.push({id:node.connections?.next});continue;}
          }
          pending.push({location});
        }
      }
      return result;
    }finally {
      if(preview)for(const id of entered)visited.delete(id);
    }
  }
  seekStep(location,values,inventory,excluded) {
    const type=this.type(location);
    // Ownership acquired during this carousel visit only disables collection.
    // Apply hiding against a fresh inventory snapshot on each container entry.
    if(type==='container'&&!location.ownedItemsAtEntry)location={...location,ownedItemsAtEntry:[...inventory]};
    if(type==='linear') {
      const cards=location.sequence?.cards ?? location.node.cards ?? [];
      while(location.index<cards.length) {
        const card=this.runtimeItem(cards[location.index],location);
        const available=conditionsMet(card.conditions,values,inventory);
        const hiddenAction=card.kind==='action'&&this.compiled.unavailableActions==='hidden'&&(!available||!affordCosts(values,inventory,card.costs,this.compiled.variables));
        const hiddenItem=card.kind==='item'&&this.hidesOwnedItem(card,inventory);
        if(this.linearItemRemaining(card,location,excluded)&&(available||card.kind==='action')&&!hiddenAction&&!hiddenItem)break;
        location={...location,index:location.index+1};
      }
      if(location.index>=cards.length)return this.nextStep(location);
    }else if(type==='container'&&!this.items(location,values,inventory,excluded).length) {
      const raw=excluded?.all&&excluded.key===this.key(location)?[]:(this.remaining.get(this.key(location))??location.sequence?.items??location.node.items??[]).filter(item=>!this.itemExcluded(item.id,location,excluded));
      // An introduction may unlock hidden items, but never revives an emptied container.
      const canUnlock=raw.length&&location.node.type==='container'&&this.introEnabled(location)&&!this.introShown(location)&&conditionsMet(this.card(location)?.conditions,values,inventory)&&this.card(location)?.effects?.length;
      if(!canUnlock)return this.nextStep(location);
    }
    return {ready:true,location};
  }
  nextStep(location,output='next') {
    if(location.queue?.length) {
      const queue=[...location.queue],id=queue.shift();
      return {location:{...location,sequence:location.node.sequences.find(s=>s.id===id),queue,index:0,ownedItemsAtEntry:undefined}};
    }
    const key=location.node.type==='legacyPool'?'next':output;
    return {id:location.node.connections?.[key]};
  }
  seek(location,values=this.variables,inventory=this.inventory,visited=new Set(),excluded=null,preview=false,preflight=null) {
    return this.traverse({location},values,inventory,visited,excluded,preview,preflight);
  }
  next(location,output='next',values=this.variables,inventory=this.inventory,visited=new Set(),excluded=null,preview=false,preflight=null) {
    return this.traverse(this.nextStep(location,output),values,inventory,visited,excluded,preview,preflight);
  }
  destination(source,success,values=this.variables,inventory=this.inventory,location=this.location,preview=false,excluded=null) {
    const type=this.type(location);
    if(type==='linear') {
      return this.seek({...location,index:location.index+1},values,inventory,new Set(),excluded,preview);
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
    if(transition==='collect'&&this.ownsItem(source,inventory))return true;
    try {
      const outcomes=source.resolution==='check'?[true,false]:[undefined];
      for(const outcome of outcomes) {
        const collected=transition==='collect'?addInventory(inventory,{...source,text:this.body(source)}):inventory;
        const result=transact(values,collected,{triggerItem:transition?undefined:source.contextInventoryKey??source.contextItemId,costs:transition?[]:source.costs,effects:transition?(transition==='collect'?collectionEffects(source):[]):[...(source.effects??[]),...(outcome===undefined?[]:outcome?source.successEffects??[]:source.failureEffects??[])]},this.compiled.variables,this.compiled.library);
        // A full drawer can exchange this item without leaving its stack slot.
        if(transition==='collect'&&this.deck.pickup&&inventory.length>=4&&!inventory.some(owned=>(owned.definitionId??owned.id)===(source.definitionId??source.id)||source.inventoryKey&&owned.inventoryKey===source.inventoryKey))continue;
        if(this.type(location)==='container') {
          if(transition==='collect'&&this.items(location,result.variables,result.inventory,excludedItem).some(i=>i.id!==source.id))continue;
          const excluded=transition==='discard'?{key:this.key(location),itemIds:this.discardedReturns(location,source)}:{key:this.key(location),itemId:source.id};
          this.next(location,'next',result.variables,result.inventory,new Set(),excluded,true);
        }else this.destination(source,outcome,result.variables,result.inventory,location,true,transition==='collect'?{key:this.key(location),itemId:source.id}:{key:this.key(location),itemIds:this.discardedReturns(location,source)});
      }
      return false;
    }catch(error) {
      // Transaction errors retain their existing runtime error/retry behavior.
      return error.message==='Unlinked output'||error.message==='Automatic routing cycle'||error.message.startsWith('Unknown node:');
    }
  }
  adopt(destination,notify=true) {this.completed=!!destination.completed;if(!this.completed)this.location=destination;if(notify)this.notify();}
  body(card) {return cardBody(card);}
  action(card,values=this.variables) {
    const {context,...content}=card;
    const typed={...card,kind:card.kind ?? (this.type()==='container'?'item':'action')};
    const face=cardFace(typed,this.compiled.variables,this.compiled.library,values);
    const checkInfo=card.resolution==='check'?playerCheckPresentation(card.check,values,this.compiled.variables):null;
    return {...content,...(card.resolution==='check'?{checkTarget:resolveCheck(card.check,values).target}:{}),
      label:card.name ?? card.label ?? 'Continue',...face,
      ...(checkInfo?{checkInfo:{...checkInfo,rules:face.summary},summary:''}:{} )};
  }
  linearTransition(location, destination, source=this.card(location)) {
    return this.type(location)==='linear'&&!['action','item','health','energy'].includes(source?.kind)&&destination&&!destination.completed&&this.key(location)===this.key(destination)&&destination.index>location.index?'reveal':'flip';
  }
  content(location=this.location,values=this.variables,inventory=this.inventory,preview=true,excludedItem=null) {
    const type=this.type(location),card=this.card(location),fork=type==='fork'||type==='forked',container=type==='container',linearFace=type==='linear'&&['action','item','health','energy'].includes(card?.kind),linearItem=linearFace&&card.kind==='item';
    let actions;
    if(fork)actions=this.choices(location).flatMap(c=>{
      if(c.contextItemId&&!canTriggerItem(inventory,c.contextInventoryKey ?? c.contextItemId))return [];
      const available=conditionsMet(c.conditions,values,inventory)&&affordCosts(values,inventory,c.costs,this.compiled.variables);
      return !available&&this.compiled.unavailableActions==='hidden'?[]:[{...this.action(c,values),disabled:!available||this.departureBlocked(c,location,values,inventory)}];
    });
    else if(container)actions=this.items(location,values,inventory,excludedItem).map(c=>({...this.action(c,values),alreadyOwned:this.ownsItem(c,inventory),discardDisabled:this.departureBlocked(c,location,values,inventory,'discard',excludedItem),collectDisabled:this.departureBlocked(c,location,values,inventory,'collect',excludedItem)}));
    else if(linearFace)actions=[{...this.action(card,values),disabled:!conditionsMet(card.conditions,values,inventory)||!affordCosts(values,inventory,card.kind==='action'?card.costs:[],this.compiled.variables)}];
    else actions=[{id:'continue',label:'Continue',image:card?.image,flipImage:!!card?.flipImage}];
    if(linearFace) {
      if(linearItem)Object.assign(actions[0],{alreadyOwned:this.ownsItem(card,inventory),discardDisabled:this.departureBlocked(card,location,values,inventory,'discard'),collectDisabled:this.departureBlocked(card,location,values,inventory,'collect')});
      else actions[0].disabled ||= this.departureBlocked(card,location,values,inventory);
    }
    if(container||linearItem)for(const action of actions)action.disabled ||= action.collectDisabled&&action.discardDisabled;
    if(!actions.length)actions=[{id:'unavailable',label:'No available choices',disabled:true}];
    const payload={autoBrowse:fork||container,id:`${this.generation}:${++this.serial}`,cardBack:this.compiled.cardBack,backOperation:card?.resolution==='check'?'dice':null,title:card?.name ?? card?.title ?? '',heading:cardFace(card,this.compiled.variables,this.compiled.library,values).heading,text:this.body(card),cardKind:card?.kind ?? 'event',value:card?.value,summary:card&&!isStoryKind(card.kind??card.cardKind)&&fork?playerCardSummary(card,this.compiled.variables,this.compiled.library,values):'',image:card?.image ?? '',imageScale:card?.imageScale??100,imageOffsetX:card?.imageOffsetX??0,imageOffsetY:card?.imageOffsetY??0,flipImage:!!card?.flipImage,actions,directAdvance:!fork&&!container&&!linearFace,decisionOnly:linearFace||fork&&(location.sequence?!!location.sequence.decisionOnly:this.presentation(location,values,inventory)==='open'),interaction:container||linearItem?'container':'choice',discardAll:container,allowClose:false};
    if(fork)payload.choiceFollowerRatio=.82;
    payload.flipItemsOnReveal=container&&this.presentation(location,values,inventory)==='closed';
    if(payload.directAdvance){payload.nextTransition='flip';payload.advanceDisabled=this.departureBlocked(card,location,values,inventory);actions[0].disabled=payload.advanceDisabled;}
    if(type==='linear'&&preview&&card&&card.kind!=='item'&&card.resolution!=='check') {
      try {
        const predicted=transact(values,inventory,{triggerItem:card.contextInventoryKey??card.contextItemId,costs:card.costs,effects:card.effects},this.compiled.variables,this.compiled.library);
        const next=this.seek({...location,index:location.index+1},predicted.variables,predicted.inventory,new Set(),null,true);
        payload.nextTransition=this.linearTransition(location,next,card);
        if(next&&!next.completed) {
          const nextContent=this.content(next,predicted.variables,predicted.inventory,false);
          payload.nextDeckPreview={content:nextContent,presentation:this.presentation(next,predicted.variables,predicted.inventory)};
          if(this.type(next)==='linear')payload.nextCardPreview={title:nextContent.title,heading:nextContent.heading,text:nextContent.text,image:nextContent.image,imageScale:nextContent.imageScale,imageOffsetX:nextContent.imageOffsetX,imageOffsetY:nextContent.imageOffsetY,flipImage:nextContent.flipImage,cardKind:nextContent.cardKind,value:nextContent.value};
        }
      }catch { /* An invalid transaction must never leak a speculative successor. */ }
    }
    return payload;
  }
  presentation(location=this.location,values=this.variables,inventory=this.inventory) {
    const type=this.type(location);
    if(type==='linear'&&['action','item','health','energy'].includes(this.card(location)?.kind))return 'open';
    if(type==='fork')return this.introEnabled(location)&&!this.introShown(location)&&conditionsMet(this.card(location)?.conditions,values,inventory)?'closed':'open';
    if(type==='forked')return location.sequence.decisionOnly?'open':'closed';
    if(type==='container'&&(!this.introEnabled(location)||this.introShown(location)||!conditionsMet(this.card(location)?.conditions,values,inventory)))return 'open';
    return 'closed';
  }
  reportBlocked(content=this.deck.content) {
    if((['fork','forked'].includes(this.type())||this.type()==='linear'&&this.card()?.kind==='action')&&this.presentation()==='open'&&!content.actions.some(a=>!a.disabled))this.error(Object.assign(new Error(`No available choices at ${this.location.node.name || this.location.node.id}. Check choice requirements, costs and inventory triggers, or restart.`),{code:'NO_AVAILABLE_CHOICES'}));
  }
  show({transition='flip',restore=false,presentation,animate=true,autoBrowse=true,preserveInventoryContext=false}={}) {
    if(this.completed){this.deck.endContent();if(!this.deck.busy)this.deck.completeCommit?.();this.notify();return;}
    if(restore)this.deck.reset();
    if(this.type()==='container'&&!conditionsMet(this.card()?.conditions,this.variables,this.inventory)){this.location.introRevealed=true;this.revealedIntros.add(this.key());}
    const content=this.content();
    content.autoBrowse=content.autoBrowse&&autoBrowse;
    this.deck.replaceContent(content,{presentation:presentation ?? this.presentation(),transition,animate,preserveInventoryContext});this.reportBlocked(content);this.notify();
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
  transaction(source,outcome) {return transact(this.variables,this.inventory,{triggerItem:source.contextInventoryKey??source.contextItemId,costs:source.costs,effects:[...(source.effects??[]),...(outcome===undefined?[]:outcome?source.successEffects??[]:source.failureEffects??[])]},this.compiled.variables,this.compiled.library);}
  available(source) {return (!source.contextItemId||canTriggerItem(this.inventory,source.contextInventoryKey??source.contextItemId))&&conditionsMet(source.conditions,this.variables,this.inventory)&&affordCosts(this.variables,this.inventory,source.costs,this.compiled.variables);}
  commit(detail) {
    if(this.destroyed||this.completed||this.checking||this.pendingItem||this.pendingIntro||(this.type()==='container'||this.type()==='linear'&&this.card()?.kind==='item')||detail.contentId!==this.deck.content.id||this.accepted.has(detail.contentId))return;
    const action=this.deck.content.actions.find(a=>a.id===detail.action?.id&&!a.disabled);if(!action)return;
    const source=['fork','forked'].includes(this.type())?this.choices().find(c=>c.id===action.id):this.card();
    if(!source||!this.available(source)||this.departureBlocked(source)){this.show({restore:true});return;}
    // Only the current/in-flight presentation can be accepted. Older events
    // already fail the content-ID guard, so retaining their IDs grows forever.
    this.accepted.clear();this.accepted.add(detail.contentId);
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
      const check=resolveCheck(source.check,this.variables);
      const result=await this.rollCheck(check.pool,{signal:abort.signal,target:check.target});
      if(abort.signal.aborted||generation!==this.generation||this.destroyed)return;
      const dice=Array.isArray(result)?result:result?.dice;
      const raw=typeof result==='number'?result:Array.isArray(dice)?dice.reduce((sum,d)=>sum+(typeof d==='number'?d:d.value),0):result?.total;
      if(!Number.isFinite(raw))throw new TypeError('Invalid dice result');
      const modifier=check.modifier;
      if(!Number.isFinite(modifier))throw new TypeError('Invalid check modifier');
      const total=raw+modifier,success=total>=check.target;
      await this.onCheckResult({total,target:check.target,success,dice:dice??[],signal:abort.signal});
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
  collectionInventory(item, replacementId) {
    if (this.ownsItem(item)) throw new Error('Item is already owned');
    let inventory = this.inventory;
    if (replacementId) {
      if (inventory.length < 4 || !inventory.some(owned => (owned.definitionId ?? owned.id) === replacementId)) throw new Error('Inventory replacement is no longer available');
      inventory = inventory.filter(owned => (owned.definitionId ?? owned.id) !== replacementId);
    }
    if (!replacementId && inventory.length >= 4 && this.deck.pickup) throw new Error('Choose an inventory item to replace');
    return inventory;
  }
  authorizeCollection(action, decision) {
    if (this.destroyed || this.completed || this.checking || this.pendingItem || this.pendingIntro) return false;
    const item = this.type() === 'linear' && this.card()?.kind === 'item' ? this.card() : this.items().find(item => item.id === action.id);
    if (!item || item.id !== action.id || !conditionsMet(item.conditions, this.variables, this.inventory)) return false;
    try {
      const inventory = this.collectionInventory(item, decision.replacementId);
      if (!decision.returnToStack && this.departureBlocked(item, this.location, this.variables, inventory, 'collect')) return false;
      const collected = addInventory(inventory, {...item, text:this.body(item)});
      transact(this.variables, collected, {effects:collectionEffects(item)}, this.compiled.variables, this.compiled.library);
      return true;
    } catch (error) { this.error(error); return false; }
  }
  exchangeCollection(action, decision) {
    if (!decision.returnToStack || !decision.replacementId || !this.authorizeCollection(action, decision)) return false;
    const item = this.type()==='linear' ? this.card() : this.items().find(item=>item.id===action.id);
    const displaced = this.inventory.find(owned=>(owned.definitionId??owned.id)===decision.replacementId);
    if (!displaced || !item || !this.deck.pickup || this.deck.busy || this.deck.drag || this.deck.phase!=='choices') return false;
    try {
      const {context,...itemContent}=item;
      const inventory=addInventory(this.collectionInventory(item,decision.replacementId),{...itemContent,text:this.body(item)});
      const result=transact(this.variables,inventory,{effects:collectionEffects(item)},this.compiled.variables,this.compiled.library);
      // Reuse this runtime placement, preserving the displaced definition. Spawn
      // conditions have served their purpose; the returned owned item stays visible.
      const returned={...displaced,id:item.id,definitionId:displaced.definitionId??displaced.id,conditions:[]};
      const returnedAction={...this.action(returned,result.variables),discardDisabled:this.departureBlocked(returned,this.location,result.variables,result.inventory,'discard'),collectDisabled:false};
      const key=this.key(),generation=this.generation;
      const previous={variables:this.variables,inventory:this.inventory,replacement:this.itemReplacements.get(key)?.get(item.id)};
      if (!this.itemReplacements.has(key)) this.itemReplacements.set(key,new Map());
      this.itemReplacements.get(key).set(item.id,returned);
      this.variables=result.variables;this.inventory=result.inventory;
      this.pendingExchange={contentId:this.deck.content.id};
      if (!this.deck.exchangePickup(returnedAction,decision)) {
        this.variables=previous.variables;this.inventory=previous.inventory;this.pendingExchange=null;
        if(previous.replacement)this.itemReplacements.get(key).set(item.id,previous.replacement);
        else this.itemReplacements.get(key).delete(item.id);
        return false;
      }
      if(this.generation===generation&&!this.destroyed)this.notify();
      return true;
    } catch(error) { this.error(error); return false; }
  }
  resolveItem(detail,transition) {
    const linearItem=this.type()==='linear'&&this.card()?.kind==='item';
    const all=transition==='discard'&&detail.all===true&&!linearItem;
    if(this.destroyed||this.completed||this.checking||this.pendingItem||this.pendingIntro||(!linearItem&&this.type()!=='container')||detail.contentId!==this.deck.content.id)return;
    const item=linearItem?this.card():this.items().find(i=>i.id===detail.action?.id);
    if(!item||item.id!==detail.action?.id||!conditionsMet(item.conditions,this.variables,this.inventory))return;
    let baseInventory;
    try { baseInventory = transition === 'collect' ? this.collectionInventory(item, detail.replacementId) : this.inventory; }
    catch(error) { this.error(error); this.show({restore:true}); return; }
    if(this.departureBlocked(item,this.location,this.variables,baseInventory,transition)){this.show({restore:true});return;}
    try {
      const {context,...itemContent}=item;
      const inventory=transition==='collect'?addInventory(baseInventory,{...itemContent,text:this.body(item)}):this.inventory;
      const result=transact(this.variables,inventory,{effects:transition==='collect'?collectionEffects(item):[]},this.compiled.variables,this.compiled.library);
      this.pendingItem={item,key:this.key(),linearItem,all,transition,contentId:detail.contentId,result,removedIds:transition==='discard'?this.discardedReturns(this.location,item):[]};
      if(detail.final||linearItem||all) {
        const retainContainer=!linearItem&&!all&&this.items(this.location,result.variables,result.inventory,item.id).length>0;
        const excluded=transition==='collect'?{key:this.key(),itemId:item.id}:null;
        this.stagedDestination=linearItem?this.destination(item,undefined,result.variables,result.inventory):retainContainer?this.location:this.next(this.location,'next',result.variables,result.inventory,new Set(),excluded);
        if(this.stagedDestination.completed)this.deck.endContent();
        else {
          const content=this.content(this.stagedDestination,result.variables,result.inventory,true,retainContainer?item.id:null);
          if(retainContainer)content.autoBrowse=false;
          const presentation=retainContainer?'open':this.presentation(this.stagedDestination,result.variables,result.inventory);
          const preserveInventoryContext=isInventoryContext(content,presentation);
          this.deck.replaceContent(content,{presentation,transition:'flip',preserveInventoryContext});
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
    if(this.pendingExchange&&detail.transition==='cancel'&&detail.contentId===this.pendingExchange.contentId) {
      this.pendingExchange=null;
      // Ownership and collection effects can change sibling visibility or flags.
      // Reconcile only after the returned face has reached its original slot.
      this.deck.refreshInventoryActions(this.content().actions);
      this.notify();
      return;
    }
    const pending=this.pendingItem;
    if(pending&&detail.transition===pending.transition&&detail.contentId===pending.contentId) {
      if(pending.transition==='collect'||pending.removedIds.length) {
        const raw=this.remaining.get(pending.key)??(pending.linearItem?this.location.sequence?.cards??this.location.node.cards:this.location.sequence?.items??this.location.node.items)??[];
        const removed=new Set(pending.transition==='collect'?[pending.item.id]:pending.removedIds);
        this.remaining.set(pending.key,raw.filter(i=>!removed.has(i.id)));
        for(const id of removed)this.itemReplacements.get(pending.key)?.delete(id);
      }
      this.variables=pending.result.variables;this.inventory=pending.result.inventory;this.pendingItem=null;this.notify();
      if(!this.stagedDestination) {
        if(!this.items().length){this.adopt(this.next(this.location),false);this.show();}
        else {
          const visible=this.items().map(i=>i.id),shown=this.deck.content.actions.map(a=>a.id);
          const updated=this.content();
          if(visible.length!==shown.length||visible.some(id=>!shown.includes(id))||updated.actions.some(a=>{const old=this.deck.content.actions.find(c=>c.id===a.id);return old?.collectDisabled!==a.collectDisabled||old?.discardDisabled!==a.discardDisabled||old?.alreadyOwned!==a.alreadyOwned||old?.disabled!==a.disabled;})) {
            // Ownership can disable/hide another placement of this item. Keep
            // surviving articles and their presentation instead of reinstalling.
            if(typeof this.deck.refreshInventoryActions==='function')this.deck.refreshInventoryActions(updated.actions);
            else this.show({presentation:'open',animate:false,autoBrowse:false,preserveInventoryContext:true});
          }
        }
      }
    }else if(detail.transition==='commit'&&this.stagedDestination){const destination=this.stagedDestination;this.stagedDestination=null;this.adopt(destination);if(!this.completed)this.reportBlocked();}
    else this.notify();
  }
  destroy() {if(this.destroyed)return;this.destroyed=true;++this.generation;this.checking?.abort();this.checking=null;for(const [name,listener]of Object.entries(this.listeners))this.deck.removeEventListener(name,listener);}
}
