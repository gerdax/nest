import {CombatCoordinator} from './CombatCoordinator.js';
import {combatCard,enemyActionCard} from './combat-presentation.js';
import {definition as combatDefinition} from './combat-rules.js';
import { createError, errorMessage, errorCode } from '../errors.js';
import { retainsInventoryItems } from './nodeTypes.js';
import { initialValues, conditionsMet, affordCosts, transact, addInventory, canTriggerItem, inventoryQuantity } from './state.js';
import { cardBody, cardFace, actionCardFace } from './presentation.js';
import { playerCardSummary, isStoryKind, collectionEffects, progressionEffects } from './cards.js';
import { selectPool } from '../chapter/random.js';
import { isInventoryContext } from '../engine/inventoryContext.js';
import { resolveCheck } from './checks.js';
import { actionAvailability } from './action-availability.js';

/** Playback only. CardDeck remains responsible for gestures and departure choreography. */
export class ProjectController {
  constructor(deck, compiled, {onChange=()=>{},rng=Math.random,rollCheck,onCheckResult=()=>{},onError=()=>{},onStart=()=>{},onSuccess=()=>{},initialState,nodeEntryEffects={}} = {}) {
    this.deck=deck; this.compiled=compiled; this.nodes=new Map(compiled.nodes.map(n=>[n.id,n]));
    Object.assign(this,{onChange,rng,rollCheck,onCheckResult,onError,onStart,onSuccess});
    this.initialState = initialState ? structuredClone(initialState) : null;
    // Host-supplied test effects stay outside the compiled document.
    this.nodeEntryEffects = structuredClone(nodeEntryEffects);
    this.arrivalStates = new WeakMap();
    this.generation=0; this.serial=0; this.destroyed=false;
    this.listeners={reveal:e=>this.reveal(e.detail),commit:e=>this.commit(e.detail),collect:e=>this.resolveItem(e.detail,'collect'),discard:e=>this.resolveItem(e.detail,'discard'),transitioncomplete:e=>this.transitionComplete(e.detail)};
    for(const [name,listener] of Object.entries(this.listeners)) deck.addEventListener(name,listener);
    this.restart();
  }
  get state() { return {activeNodeId:this.location?.node.id ?? null,cardId:this.card()?.id ?? null,variables:{...this.variables},collectedItems:this.inventory.map(i=>({...i})),completed:this.completed,terminalReason:this.terminalReason,combat:this.combat?.state??null,checking:!!this.checking||!!this.combat?.checking,idle:(!this.combat||this.combat.idle)&&!this.halted&&!this.deathHandoff&&!this.completed&&!this.checking&&!this.pendingItem&&!this.pendingIntro&&!this.pendingExchange&&!this.deck.busy&&!this.deck.pickup?.pending&&!this.deck.drag&&!['revealing','closing','committing','collecting'].includes(this.deck.phase)}; }
  notify() {if(!this.destroyed)this.onChange(this.state);}
  error(error) {if(!this.destroyed)this.onError(error,this.state);}
  succeeded(nodeId) {
    if(this.destroyed)return false;
    const generation=this.generation;
    this.onSuccess(nodeId);
    return !this.destroyed&&this.generation===generation;
  }
  restart() {
    if(this.destroyed)return;
    this.combat?.dispose();this.combat=null;this.combatOperations=new Set();
    const generation=++this.generation; this.checking?.abort(); this.checking=null;this.checkPayment=null;
    this.arrivalStates = new WeakMap();
    this.deathHandoff?.abort();this.deathHandoff=null;
    this.deck.reset();
    this.variables=transact(initialValues(this.compiled.variables),[],{effects:Object.entries(this.initialState?.variables || {}).map(([key,value])=>({op:'set',key,value}))},this.compiled.variables).variables;
    this.inventory=(this.initialState?.inventory || []).reduce((items,item)=>addInventory(items,structuredClone(item)),[]);
    this.remaining=new Map(); this.itemReplacements=new Map(); this.accepted=new Set();this.revealedIntros=new Set();this.pendingIntro=null; this.pendingItem=null;this.pendingExchange=null;this.stagedDestination=null;this.completed=false;this.halted=false;this.terminalReason=null;this.deathHandoff=null;
    this.location=null;
    try {this.adopt(this.locate(this.compiled.startNode),false);this.show();if(!this.destroyed&&this.generation===generation)this.onStart(this.compiled.startNode);} catch(error){
      this.location=null;this.completed=false;
      const message=errorCode(error)==='RUNTIME_UNLINKED_OUTPUT'?errorMessage('RUNTIME_UNLINKED_OUTPUT'):errorMessage('RUNTIME_PLAYBACK_BLOCKED');
      this.deck.replaceContent({id:`${this.generation}:${++this.serial}`,title:message,actions:[{id:'unavailable',label:message,disabled:true,disabledReason:this.routingReason(error)||error.message||message}],decisionOnly:true},{presentation:'open',animate:false});
      this.error(error);this.notify();
    }
  }
  type(location=this.location) {const type=location?.sequence?.type ?? location?.node.type;return type==='death'?'linear':type;}
  // Pure selection: callers may inspect hypothetical transactions without
  // changing playback, consuming RNG, or committing entry effects.
  deathDestination(values=this.variables,location=this.location) {
    if(location?.node.type==='death'||typeof values?.health!=='number'||!Number.isFinite(values.health)||values.health>0)return null;
    const node=this.nodes.get(this.compiled.deathNode);
    return node?.type==='death'?{node,index:0,queue:[]}:null;
  }
  handoffDeath({animate=false}={}) {
    if(this.destroyed||this.halted||this.deathHandoff||this.checking||this.checkPayment||this.pendingItem||this.pendingIntro||this.pendingExchange)return false;
    const selected=this.deathDestination();if(!selected)return false;
    const generation=this.generation;
    const destination=this.locate(selected.node.id);
    this.pendingIntro=null;this.pendingExchange=null;this.stagedDestination=null;
    this.adopt(destination,false);
    if(this.destroyed||generation!==this.generation)return false;
    if(animate&&typeof this.deck.transitionContent==='function'&&!this.halted) {
      const abort=new AbortController();this.deathHandoff=abort;
      const content=this.content(),presentation=this.presentation();
      Promise.resolve(this.deck.transitionContent(content,{transition:'front-turn',surface:'front',presentation,signal:abort.signal})).then(accepted=>{
        if(this.destroyed||generation!==this.generation||this.deathHandoff!==abort)return;
        this.deathHandoff=null;
        if(!accepted)this.show();else this.notify();
      }).catch(error=>{
        if(this.destroyed||generation!==this.generation||this.deathHandoff!==abort)return;
        this.deathHandoff=null;this.error(error);this.show();
      });
      this.notify();
    }else this.show({transition:'flip'});
    return true;
  }
  unavailableActions(location=this.location) {
    const node=location?.node;
    const override=['fork','linear'].includes(node?.type) ? node.unavailableActions : undefined;
    return (override && override!=='project' ? override : this.compiled.unavailableActions) ?? 'disabled';
  }
  cardAvailability(card, values=this.variables, inventory=this.inventory, location=this.location) {
    return actionAvailability(card ?? {},values,inventory,this.compiled,this.unavailableActions(location));
  }
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
    return raw.map(i=>this.runtimeItem(i,location)).filter(i=>!this.itemExcluded(i.id,location,excluded) && !this.cardAvailability(i,values,inventory,location).hidden && !this.hidesOwnedItem(i,inventory,location));
  }
  weighted(routes) {
    if(!routes.length)return null;
    const maximum=routes.reduce((max,r)=>Math.max(max,r.weight),0);
    const total=routes.reduce((sum,r)=>sum+r.weight/maximum,0);
    const draw=this.rng();if(!Number.isFinite(draw)||draw<0||draw>=1)throw createError('RUNTIME_RANDOM_SOURCE_MUST_RETURN_0_N_1');
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
    const pending=[{...start,values,inventory,changed:false}],entered=new Set();
    let result;
    try {
      while(pending.length) {
        const step=pending.pop();
        let {values,inventory,changed}=step;
        if(step.halted){result={halted:true,terminalReason:'death'};if(changed)this.arrivalStates.set(result,{variables:values,inventory});continue;}
        if(step.finish) {
          if(step.random)result=null;
          if(preview){preflight.completed.set(step.id,{values,inventory,result});visited.delete(step.id);entered.delete(step.id);}
          continue;
        }
        if(step.location) {
          const death=this.deathDestination(values,step.location);
          if(death){pending.push({id:death.node.id,values,inventory,changed});continue;}
          const next=this.seekStep(step.location,values,inventory,excluded);
          if(next.ready){result=next.location;if(changed)this.arrivalStates.set(result,{variables:values,inventory});}
          else pending.push({...next,values,inventory,changed});
          continue;
        }
        const id=step.id;
        if(id===null){result={completed:true};if(changed)this.arrivalStates.set(result,{variables:values,inventory});continue;}
        if(id===false||id===undefined)throw createError('RUNTIME_UNLINKED_OUTPUT');
        if(visited.has(id))throw createError('RUNTIME_AUTOMATIC_ROUTING_CYCLE');
        const cached=preview&&preflight.completed.get(id);
        if(cached&&cached.values===values&&cached.inventory===inventory){result=cached.result;continue;}
        visited.add(id);entered.add(id);
        const node=this.nodes.get(id);if(!node)throw createError('RUNTIME_UNKNOWN_NODE', { id });
        pending.push({finish:true,id,random:preview&&node.type==='random',values,inventory});
        const death=this.deathDestination(values,{node});
        if(death){pending.push({id:death.node.id,values,inventory,changed});continue;}
        // Keep entry effects speculative until the full route succeeds. Branches
        // inherit their parent's state rather than a preceding sibling's effects.
        for(const effect of Object.hasOwn(this.nodeEntryEffects,id)?this.nodeEntryEffects[id]:[]) {
          if(effect.op==='removeItem'&&!inventoryQuantity(inventory,effect.key))continue;
          const state=transact(values,inventory,{effects:[effect]},this.compiled.variables,this.compiled.library);
          values=state.variables;inventory=state.inventory;changed=true;
        }
        const enteredDeath=this.deathDestination(values,{node});
        if(enteredDeath){pending.push({id:enteredDeath.node.id,values,inventory,changed});continue;}
        if(node.type==='random') {
          const routes=(node.routes ?? []).filter(r=>r.weight>0&&conditionsMet(r.conditions,values,inventory));
          if(preview) {
            const targets=routes.length?routes.map(r=>r.target):[node.fallback];
            for(let i=targets.length-1;i>=0;i--)pending.push({id:targets[i],values,inventory,changed});
          }else {
            const selected=this.weighted(routes);
            pending.push({id:selected?selected.target:node.fallback,values,inventory,changed});
          }
        }else if(node.type==='legacyPool'&&preview)result=null;
        else {
          const location={node,index:0,queue:[]};
          if(node.type==='legacySequence')location.sequence=node.sequence;
          if(node.type==='legacyPool') {
            location.queue=selectPool(node.pool,node.count,this.rng);
            const sequenceId=location.queue.shift();
            location.sequence=node.sequences.find(s=>s.id===sequenceId);
            if(!location.sequence){pending.push({id:node.connections?.next,values,inventory,changed});continue;}
          }
          pending.push({location,values,inventory,changed});
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
        const hidden=this.cardAvailability(card,values,inventory,location).hidden;
        const hiddenItem=card.kind==='item'&&this.hidesOwnedItem(card,inventory);
        if(this.linearItemRemaining(card,location,excluded)&&!hidden&&!hiddenItem)break;
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
    if(location.node.type==='death')return {halted:true,terminalReason:'death'};
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
    const death=this.deathDestination(values,location);
    if(death)return this.locate(death.node.id,values,inventory,new Set(),excluded,preview);
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
    return !!this.departureReason(source,location,values,inventory,transition,excludedItem);
  }
  routingReason(error) {
    if(errorCode(error)==='RUNTIME_UNLINKED_OUTPUT')return errorMessage('RUNTIME_ROUTE_UNAVAILABLE');
    if(errorCode(error)==='RUNTIME_AUTOMATIC_ROUTING_CYCLE')return errorMessage('RUNTIME_AUTOMATIC_ROUTING_CYCLE');
    if(errorCode(error)==='RUNTIME_UNKNOWN_NODE')return errorMessage('RUNTIME_CONNECTED_DESTINATION_MISSING');
    return '';
  }
  departureReason(source,location=this.location,values=this.variables,inventory=this.inventory,transition=null,excludedItem=null) {
    if(transition==='collect'&&this.ownsItem(source,inventory))return 'Already owned';
    try {
      const outcomes=source.resolution==='check'?[true,false]:[undefined];
      for(const outcome of outcomes) {
        const collected=transition==='collect'?addInventory(inventory,{...source,text:this.body(source)}):inventory;
        const result=transact(values,collected,{triggerItem:transition?undefined:source.contextInventoryKey??source.contextItemId,costs:transition?[]:source.costs,effects:transition?(transition==='collect'?collectionEffects(source):[]):[...progressionEffects(source,outcome),...(outcome===undefined?[]:outcome?source.successEffects??[]:source.failureEffects??[])]},this.compiled.variables,this.compiled.library);
        // A lethal accepted result always has its implicit Death route, even
        // when this action's ordinary output is unlinked.
        if(this.deathDestination(result.variables,location))continue;
        // A full drawer can exchange this item without leaving its stack slot.
        if(transition==='collect'&&this.deck.pickup&&inventory.length>=4&&!inventory.some(owned=>(owned.definitionId??owned.id)===(source.definitionId??source.id)||source.inventoryKey&&owned.inventoryKey===source.inventoryKey))continue;
        if(this.type(location)==='container') {
          if(transition==='collect'&&this.items(location,result.variables,result.inventory,excludedItem).some(i=>i.id!==source.id))continue;
          const excluded=transition==='discard'?{key:this.key(location),itemIds:this.discardedReturns(location,source)}:{key:this.key(location),itemId:source.id};
          this.next(location,'next',result.variables,result.inventory,new Set(),excluded,true);
        }else this.destination(source,outcome,result.variables,result.inventory,location,true,transition==='collect'?{key:this.key(location),itemId:source.id}:{key:this.key(location),itemIds:this.discardedReturns(location,source)});
      }
      return '';
    }catch(error) {
      // Transaction errors retain their existing runtime error/retry behavior.
      return this.routingReason(error);
    }
  }
  arrivalState(destination,variables=this.variables,inventory=this.inventory) {return this.arrivalStates.get(destination) ?? {variables,inventory};}
  adopt(destination,notify=true) {
    if(this.combat&&destination?.node!==this.location?.node){this.combat.dispose();this.combat=null;}
    let state=this.arrivalState(destination);this.arrivalStates.delete(destination);
    const death=this.deathDestination(state.variables,destination?.node?destination:this.location);
    if(death){destination=this.locate(death.node.id,state.variables,state.inventory);state=this.arrivalState(destination,state.variables,state.inventory);this.arrivalStates.delete(destination);}
    this.variables=state.variables;this.inventory=state.inventory;
    this.completed=!!destination.completed;this.halted=!!destination.halted;this.terminalReason=destination.terminalReason??null;
    if(!this.completed&&!this.halted)this.location=destination;
    if(notify){if(this.location?.node.type==='combat'&&!this.halted&&!this.completed)this.show();else this.notify();}
  }
  body(card) {return cardBody(card);}
  action(card,values=this.variables) {
    const {context,...content}=card;
    const typed={...card,kind:card.kind ?? (this.type()==='container'?'item':'action')};
    const face=actionCardFace(typed,this.compiled.variables,this.compiled.library,values);
    return {...content,label:card.name ?? card.label ?? 'Continue',...face};
  }
  linearTransition(location, destination, source=this.card(location), values=this.variables, inventory=this.inventory) {
    const revealing=this.type(location)==='linear'&&!['action','item','consumable','health','energy'].includes(source?.kind)&&destination&&!destination.completed&&!destination.halted&&this.key(location)===this.key(destination)&&destination.index>location.index;
    if(!revealing)return 'flip';
    if(destination.index===location.index+1) {
      const following=this.runtimeItem((location.sequence?.cards??location.node.cards)[destination.index],location);
      if(!this.available(following,values,inventory)) {
        try {
          const predicted=this.transaction(source,undefined,values,inventory);
          if(this.available(following,predicted.variables,predicted.inventory))return 'flip';
        }catch { /* Invalid effects must not change the planned transition. */ }
      }
    }
    return 'reveal';
  }
  introductionUnlocksNext(location,values,inventory) {
    if(location.node.type!=='fork'||this.presentation(location,values,inventory)!=='closed')return false;
    try {
      const predicted=transact(values,inventory,{effects:this.card(location)?.effects},this.compiled.variables,this.compiled.library);
      // Hidden or unmet earlier choices do not become the next playable card.
      const following=this.choices(location).find(choice=>this.available(choice,predicted.variables,predicted.inventory));
      return !!following&&!this.available(following,values,inventory);
    }catch { return false; }
  }
  content(location=this.location,values=this.variables,inventory=this.inventory,preview=true,excludedItem=null) {
    if(location?.node.type==='combat') {
      const enemy=combatDefinition(this.compiled.library,location.node.enemy);
      if(!enemy)throw new Error('Missing Enemy definition');
      const id=`combat-preview:${location.node.id}`;
      const action={...enemyActionCard(enemy.actions[0],`${id}:action`),cardBack:this.compiled.cardBack};
      if(!enemy.introEnabled)return {...action,id};
      const content={...combatCard({...enemy,kind:'event'},id),cardBack:this.compiled.cardBack};
      content.nextTransition='reveal';
      content.nextDeckPreview={content:action,presentation:'closed'};
      return content;
    }
    ({variables:values,inventory}=this.arrivalState(location,values,inventory));
    const type=this.type(location),card=this.card(location),fork=type==='fork'||type==='forked',container=type==='container',linearFace=type==='linear'&&['action','item','consumable','health','energy'].includes(card?.kind),linearItem=linearFace&&card.kind==='item';
    let actions;
    if(fork)actions=this.choices(location).flatMap(c=>{
      const availability=actionAvailability(c,values,inventory,this.compiled,this.unavailableActions(location));
      if(availability.hidden)return [];
      const reason=availability.disabledReason||this.departureReason(c,location,values,inventory);
      return [{...this.action(c,values),disabled:availability.disabled||!!reason,...(reason?{disabledReason:reason,...(availability.disabledReason?{disabledReasonParts:availability.disabledReasonParts}:{})}:{})}];
    });
    else if(container)actions=this.items(location,values,inventory,excludedItem).map(c=>{
      const availability=this.cardAvailability(c,values,inventory,location);
      return {...this.action(c,values),disabled:availability.disabled,...(availability.disabledReason?{disabledReason:availability.disabledReason,disabledReasonParts:availability.disabledReasonParts}:{}),alreadyOwned:this.ownsItem(c,inventory),discardDisabled:availability.disabled||this.departureBlocked(c,location,values,inventory,'discard',excludedItem),collectDisabled:availability.disabled||this.departureBlocked(c,location,values,inventory,'collect',excludedItem)};
    });
    else if(linearFace) {
      const availability=this.cardAvailability(card,values,inventory,location);
      actions=[{...this.action(card,values),disabled:availability.disabled,...(availability.disabledReason?{disabledReason:availability.disabledReason,disabledReasonParts:availability.disabledReasonParts}:{})}];
    }
    else actions=[{id:'continue',label:'Continue',image:card?.image,flipImage:!!card?.flipImage}];
    if(linearFace) {
      if(linearItem)Object.assign(actions[0],{alreadyOwned:this.ownsItem(card,inventory),discardDisabled:actions[0].disabled||this.departureBlocked(card,location,values,inventory,'discard'),collectDisabled:actions[0].disabled||this.departureBlocked(card,location,values,inventory,'collect')});
      else if(!actions[0].disabled) {
        const reason=this.departureReason(card,location,values,inventory);
        if(reason) {Object.assign(actions[0],{disabled:true,disabledReason:reason});delete actions[0].disabledReasonParts;}
      }
    }
    if(container||linearItem)for(const action of actions)action.disabled ||= action.collectDisabled&&action.discardDisabled;
    if(!actions.length)actions=[{id:'unavailable',label:'No available choices',disabled:true,disabledReason:'No available choices'}];
    const payload={autoBrowse:fork||container,id:`${this.generation}:${++this.serial}`,cardBack:this.compiled.cardBack,title:card?.name ?? card?.title ?? '',heading:cardFace(card,this.compiled.variables,this.compiled.library,values).heading,text:this.body(card),cardKind:card?.kind==='consumable'?card.subtype:card?.kind ?? 'event',value:card?.value,summary:card&&!isStoryKind(card.kind??card.cardKind)&&fork?playerCardSummary(card,this.compiled.variables,this.compiled.library,values):'',image:card?.image ?? '',imageScale:card?.imageScale??100,imageOffsetX:card?.imageOffsetX??0,imageOffsetY:card?.imageOffsetY??0,flipImage:!!card?.flipImage,actions,directAdvance:!fork&&!container&&!linearFace,decisionOnly:linearFace||fork&&(location.sequence?!!location.sequence.decisionOnly:this.presentation(location,values,inventory)==='open'),interaction:container||linearItem?'container':'choice',discardAll:container,allowClose:false};
    if(fork)payload.choiceFollowerRatio=.82;
    payload.flipItemsOnReveal=container&&this.presentation(location,values,inventory)==='closed'||fork&&this.introductionUnlocksNext(location,values,inventory);
    if(payload.directAdvance){
      payload.nextTransition='flip';
      const availability=this.cardAvailability(card,values,inventory,location);
      const reason=availability.disabledReason||this.departureReason(card,location,values,inventory);
      payload.advanceDisabled=availability.disabled||!!reason;actions[0].disabled=payload.advanceDisabled;
      if(reason) {
        actions[0].disabledReason=reason;
        if(availability.disabledReason)actions[0].disabledReasonParts=availability.disabledReasonParts;
        else delete actions[0].disabledReasonParts;
      }
    }
    if(type==='linear'&&preview&&card&&!actions[0].disabled&&card.kind!=='item'&&card.resolution!=='check') {
      try {
        const predicted=transact(values,inventory,{triggerItem:card.contextInventoryKey??card.contextItemId,costs:card.costs,effects:card.effects},this.compiled.variables,this.compiled.library);
        const next=this.destination(card,undefined,predicted.variables,predicted.inventory,location,true);
        payload.nextTransition=this.linearTransition(location,next,card,values,inventory);
        if(next&&!next.completed&&!next.halted) {
          const nextContent=this.content(next,predicted.variables,predicted.inventory,false);
          payload.nextDeckPreview={content:nextContent,presentation:this.presentation(next,predicted.variables,predicted.inventory)};
          if(this.type(next)==='linear')payload.nextCardPreview={title:nextContent.title,heading:nextContent.heading,text:nextContent.text,image:nextContent.image,imageScale:nextContent.imageScale,imageOffsetX:nextContent.imageOffsetX,imageOffsetY:nextContent.imageOffsetY,flipImage:nextContent.flipImage,cardKind:nextContent.cardKind,value:nextContent.value};
        }
      }catch { /* An invalid transaction must never leak a speculative successor. */ }
    }
    return payload;
  }
  presentation(location=this.location,values=this.variables,inventory=this.inventory) {
    ({variables:values,inventory}=this.arrivalState(location,values,inventory));
    const type=this.type(location);
    if(type==='linear'&&['action','item','consumable','health','energy'].includes(this.card(location)?.kind))return 'open';
    if(type==='fork')return this.introEnabled(location)&&!this.introShown(location)&&conditionsMet(this.card(location)?.conditions,values,inventory)?'closed':'open';
    if(type==='forked')return location.sequence.decisionOnly?'open':'closed';
    if(type==='container'&&(!this.introEnabled(location)||this.introShown(location)||!conditionsMet(this.card(location)?.conditions,values,inventory)))return 'open';
    return 'closed';
  }
  reportBlocked(content=this.deck.content) {
    if((['fork','forked'].includes(this.type())||this.type()==='linear'&&this.card()?.kind==='action')&&this.presentation()==='open'&&!content.actions.some(a=>!a.disabled))this.error(createError('NO_AVAILABLE_CHOICES', { nodeName: this.location.node.name || this.location.node.id }));
  }
  show({transition='flip',restore=false,presentation,animate=true,autoBrowse=true,preserveInventoryContext=false}={}) {
    if(this.location?.node.type==='combat'&&!this.completed&&!this.halted){
      if(!this.combat){
        const enemy=combatDefinition(this.compiled.library,this.location.node.enemy);
        if(!enemy)throw new Error('Missing Enemy definition');
        this.combat=new CombatCoordinator(this,enemy,this.location.node);void this.combat.start();
      }
      return;
    }
    if(this.completed||this.halted){this.deck.endContent();if(!this.deck.busy)this.deck.completeCommit?.();this.notify();return;}
    if(restore)this.deck.reset();
    if(this.type()==='container'&&!conditionsMet(this.card()?.conditions,this.variables,this.inventory)){this.location.introRevealed=true;this.revealedIntros.add(this.key());}
    const content=this.content();
    content.autoBrowse=content.autoBrowse&&autoBrowse;
    this.deck.replaceContent(content,{presentation:presentation ?? this.presentation(),transition,animate,preserveInventoryContext});this.reportBlocked(content);this.notify();
  }
  reveal(detail) {
    if(this.destroyed||this.completed||this.halted||this.deathHandoff||this.checking||this.pendingItem||this.pendingIntro||this.pendingExchange||!['container','fork'].includes(this.location.node.type)||!this.introEnabled()||detail.contentId!==this.deck.content.id||this.introShown())return;
    const intro=this.card();
    if(!conditionsMet(intro?.conditions,this.variables,this.inventory))return;
    try {
      const result=transact(this.variables,this.inventory,{effects:intro?.effects},this.compiled.variables,this.compiled.library);
      this.location.introRevealed=true;this.revealedIntros.add(this.key());this.pendingIntro={contentId:detail.contentId};
      this.variables=result.variables;this.inventory=result.inventory;
      if(this.deathDestination()&&this.deck.commitMotion?.introduction) {
        const sourceNodeId=this.location.node.id;
        if(!this.succeeded(sourceNodeId))return;
        this.pendingIntro=null;this.handoffDeath();return;
      }
      if(['container','fork'].includes(this.type())&&this.deck.commitMotion?.introduction) {
        const content=this.content();content.id=detail.contentId;
        this.deck.replaceContent(content,{presentation:'open',transition:'flip'});
      }
      if(!this.succeeded(this.location.node.id))return;
      this.notify();
    }catch(error){this.error(error);this.show({restore:true});}
  }
  transaction(source,outcome,values=this.variables,inventory=this.inventory) {return transact(values,inventory,{triggerItem:source.contextInventoryKey??source.contextItemId,costs:source.costs,effects:[...progressionEffects(source,outcome),...(outcome===undefined?[]:outcome?source.successEffects??[]:source.failureEffects??[])]},this.compiled.variables,this.compiled.library);}
  available(source,values=this.variables,inventory=this.inventory) {return (!(source.contextInventoryKey??source.contextItemId)||canTriggerItem(inventory,source.contextInventoryKey??source.contextItemId))&&conditionsMet(source.conditions,values,inventory)&&affordCosts(values,inventory,source.costs,this.compiled.variables);}
  commit(detail) {
    if(this.combat){void this.combat.accept(detail);return;}
    if(this.destroyed||this.completed||this.halted||this.deathHandoff||this.checking||this.pendingItem||this.pendingIntro||this.pendingExchange||(this.type()==='container'||this.type()==='linear'&&this.card()?.kind==='item')||detail.contentId!==this.deck.content.id||this.accepted.has(detail.contentId))return;
    const action=this.deck.content.actions.find(a=>a.id===detail.action?.id&&!a.disabled);if(!action)return;
    const source=['fork','forked'].includes(this.type())?this.choices().find(c=>c.id===action.id):this.card();
    if(!source||!this.available(source)||this.departureBlocked(source)){this.show({restore:true});return;}
    // Only the current/in-flight presentation can be accepted. Older events
    // already fail the content-ID guard, so retaining their IDs grows forever.
    this.accepted.clear();this.accepted.add(detail.contentId);
    if(source.resolution==='check'){this.runCheck(source);return;}
    try {
      const result=this.transaction(source);const destination=this.destination(source,undefined,result.variables,result.inventory);
      const sourceNodeId=this.location.node.id;
      const transition=this.linearTransition(this.location,destination,source);
      this.variables=result.variables;this.inventory=result.inventory;
      this.adopt(destination,false);if(!this.succeeded(sourceNodeId))return;this.show({transition});
    }catch(error){this.error(error);this.show({restore:true});}
  }
  async runCheck(source) {
    if(this.departureBlocked(source))return;
    const sourceNodeId=this.location.node.id;
    const generation=this.generation,abort=new AbortController();this.checking=abort;
    try {
      if(!this.rollCheck)throw createError('RUNTIME_NO_DICE_ROLLER_SUPPLIED');
      const before={variables:this.variables,inventory:this.inventory};
      const check=resolveCheck(source.check,before.variables);
      const paid=transact(before.variables,before.inventory,{costs:source.costs},this.compiled.variables,this.compiled.library);
      this.checkPayment={abort,...before,paid:structuredClone(paid),expected:JSON.stringify(paid)};
      this.variables=paid.variables;this.inventory=paid.inventory;this.notify();
      // Observers can synchronously cancel, restart or destroy playback.
      if(abort.signal.aborted||generation!==this.generation||this.destroyed)return;
      const result=await this.rollCheck(check.pool,{signal:abort.signal,target:check.target});
      if(abort.signal.aborted||generation!==this.generation||this.destroyed)return;
      const dice=Array.isArray(result)?result:result?.dice;
      const raw=typeof result==='number'?result:Array.isArray(dice)?dice.reduce((sum,d)=>sum+(typeof d==='number'?d:d.value),0):result?.total;
      if(!Number.isFinite(raw))throw createError('RUNTIME_INVALID_DICE_RESULT');
      const modifier=check.modifier;
      if(!Number.isFinite(modifier))throw createError('RUNTIME_INVALID_CHECK_MODIFIER');
      const total=raw+modifier,success=total>=check.target;
      await this.onCheckResult({total,target:check.target,success,dice:dice??[],signal:abort.signal});
      if(abort.signal.aborted||generation!==this.generation||this.destroyed)return;
      if(JSON.stringify({variables:this.variables,inventory:this.inventory})!==this.checkPayment.expected)throw createError('RUNTIME_CHECK_REQUIREMENTS_CHANGED');
      if(this.departureBlocked(source,this.location,before.variables,before.inventory))throw createError('RUNTIME_UNLINKED_OUTPUT');
      // Resolve atomically from the original state: costs are already visible,
      // while trigger uses and effects retain their established ordering.
      const next=this.transaction(source,success,before.variables,before.inventory);const destination=this.destination(source,success,next.variables,next.inventory);
      this.variables=next.variables;this.inventory=next.inventory;this.checkPayment=null;this.checking=null;this.adopt(destination,false);if(!this.succeeded(sourceNodeId))return;this.show();
    }catch(error){
      if(generation!==this.generation||this.destroyed)return;
      this.restoreCheckPayment(abort);this.checking=null;if(error?.name!=='AbortError')this.error(error);this.show({restore:true});
    }
  }
  restoreCheckPayment(abort) {
    if(this.checkPayment?.abort!==abort)return;
    const payment=this.checkPayment;this.checkPayment=null;
    if(JSON.stringify({variables:this.variables,inventory:this.inventory})===payment.expected){
      this.variables=payment.variables;this.inventory=payment.inventory;return;
    }
    const effects=Object.keys(payment.variables).filter(key=>typeof payment.variables[key]==='number'&&typeof this.variables[key]==='number'&&payment.variables[key]!==payment.paid.variables[key])
      .map(key=>({op:'add',key,value:payment.variables[key]-payment.paid.variables[key]}));
    this.variables=transact(this.variables,this.inventory,{effects},this.compiled.variables,this.compiled.library).variables;
    // Refund only spent inventory costs; preserve unrelated live ownership edits.
    const paidIds=new Set(payment.paid.inventory.map(item=>item.definitionId??item.id));
    for(const item of payment.inventory)if(!paidIds.has(item.definitionId??item.id))this.inventory=addInventory(this.inventory,item);
  }
  cancelCheck() {if(!this.checking)return false;const abort=this.checking;abort.abort();this.restoreCheckPayment(abort);this.checking=null;++this.generation;this.show({restore:true});return true;}
  collectionInventory(item, replacementId) {
    if (this.ownsItem(item)) throw createError('RUNTIME_ITEM_IS_ALREADY_OWNED');
    let inventory = this.inventory;
    if (replacementId) {
      if (inventory.length < 4 || !inventory.some(owned => (owned.definitionId ?? owned.id) === replacementId)) throw createError('RUNTIME_INVENTORY_REPLACEMENT_IS_NO_LONGER_AVAILABLE');
      inventory = inventory.filter(owned => (owned.definitionId ?? owned.id) !== replacementId);
    }
    if (!replacementId && inventory.length >= 4 && this.deck.pickup) throw createError('RUNTIME_CHOOSE_AN_INVENTORY_ITEM_TO_REPLACE');
    return inventory;
  }
  authorizeCollection(action, decision) {
    if(this.combat)return false;
    if (this.destroyed || this.completed || this.halted || this.deathHandoff || this.checking || this.pendingItem || this.pendingIntro || this.pendingExchange) return false;
    const item = this.type() === 'linear' && this.card()?.kind === 'item' ? this.card() : this.items().find(item => item.id === action.id);
    if (!item || item.id !== action.id || this.cardAvailability(item).disabled) return false;
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
      if(this.generation===generation&&!this.destroyed&&this.succeeded(this.location.node.id))this.notify();
      return true;
    } catch(error) { this.error(error); return false; }
  }
  resolveItem(detail,transition) {
    if(this.combat)return;
    const linearItem=this.type()==='linear'&&this.card()?.kind==='item';
    const all=transition==='discard'&&detail.all===true&&!linearItem;
    if(this.destroyed||this.completed||this.halted||this.deathHandoff||this.checking||this.pendingItem||this.pendingIntro||this.pendingExchange||(!linearItem&&this.type()!=='container')||detail.contentId!==this.deck.content.id)return;
    const item=linearItem?this.card():this.items().find(i=>i.id===detail.action?.id);
    if(!item||item.id!==detail.action?.id||this.cardAvailability(item).disabled)return;
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
        const death=this.deathDestination(result.variables);
        const retainContainer=!death&&!linearItem&&!all&&this.items(this.location,result.variables,result.inventory,item.id).length>0;
        const excluded=transition==='collect'?{key:this.key(),itemId:item.id}:null;
        this.stagedDestination=death?this.locate(death.node.id,result.variables,result.inventory):linearItem?this.destination(item,undefined,result.variables,result.inventory):retainContainer?this.location:this.next(this.location,'next',result.variables,result.inventory,new Set(),excluded);
        if(this.stagedDestination.completed||this.stagedDestination.halted)this.deck.endContent();
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
        if(this.handoffDeath({animate:true}))return;
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
      if(this.handoffDeath({animate:true}))return;
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
      this.variables=pending.result.variables;this.inventory=pending.result.inventory;this.pendingItem=null;
      const generation=this.generation;
      if(!this.succeeded(this.location.node.id))return;
      this.notify();
      // Host callbacks may tear down or restart playback after accepting ownership.
      if(this.destroyed||this.generation!==generation)return;
      if(!this.stagedDestination) {
        if(this.handoffDeath({animate:true}))return;
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
    }else if(detail.transition==='commit'&&this.stagedDestination){const destination=this.stagedDestination,generation=this.generation;this.stagedDestination=null;this.adopt(destination);if(!this.destroyed&&this.generation===generation&&!this.completed&&!this.halted)this.reportBlocked();}
    else this.notify();
  }
  commitCombatDamage(operationId, health, effects=[]) {
    return this.commitCombatEffects(operationId,[{op:'set',key:'health',value:health},...effects]);
  }
  commitCombatEffects(operationId,effects,{onCommit}={}) {
    if(this.destroyed||!this.combat)return false;
    this.combatOperations??=new Set();
    if(this.combatOperations.has(operationId))return this.variables.health>0;
    const result=transact(this.variables,this.inventory,{effects},this.compiled.variables,this.compiled.library);
    if(!Number.isSafeInteger(result.variables.health))throw new Error('Combat progression effects require integer Health values');
    this.variables=result.variables;this.inventory=result.inventory;
    // The encounter owner publishes intrinsic Enemy HP in this same commit,
    // after validation and before notifications or global death routing.
    onCommit?.();this.combatOperations.add(operationId);
    if(this.deathDestination()){this.handoffDeath();return false;}
    this.notify();return true;
  }
  combatVictoryReason() {
    const target=this.location?.node.connections?.victory;
    if(typeof target!=='string'||!target||!this.nodes.has(target))return 'Route unavailable';
    try {this.next(this.location,'victory',this.variables,this.inventory,new Set(),null,true);return '';}
    catch(error){return this.routingReason(error)||'Route unavailable';}
  }
  completeCombatVictory() {
    if(!this.combat||this.combatVictoryReason())return false;
    const generation=this.generation,nodeId=this.location.node.id;
    try {
      const destination=this.next(this.location,'victory');
      this.combat.dispose();this.combat=null;
      if(!this.succeeded(nodeId)||this.generation!==generation)return false;
      this.adopt(destination,false);this.show();return true;
    }catch(error){this.error(error);return false;}
  }
  destroy() {if(this.destroyed)return;this.combat?.dispose();this.combat=null;this.destroyed=true;++this.generation;this.deathHandoff?.abort();this.deathHandoff=null;this.checking?.abort();this.checking=null;this.checkPayment=null;for(const [name,listener]of Object.entries(this.listeners))this.deck.removeEventListener(name,listener);}
}
