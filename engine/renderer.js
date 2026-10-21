import { layoutBounds } from './cssScale.js';
import { handoffRadius, projectedBounds } from './geometry.js?v=no-ending-card-1';
import { carouselPose, clamp, departureDistance, revealScale, flipLift } from './motion.js?v=no-ending-card-1';
import { applyArtworkColorize } from './artworkColorize.js';
import { resolveBackAppearance } from './cardBacks.js';

// Stable per-card variation: adjacent IDs should not produce a regular fan,
// and repeated renders of a held gesture must never jitter.
function discardVariation(id, channel) {
  let seed = 2166136261;
  for (const char of `${id}:${channel}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  seed = Math.imul(seed ^ seed >>> 16, 0x7feb352d);
  seed = Math.imul(seed ^ seed >>> 15, 0x846ca68b);
  return ((seed ^ seed >>> 16) >>> 0) / 4294967296;
}

function flipped(action) { return !!action.flipImage; }

function cardTexture() {
  const texture = document.createElement('div');
  texture.className = 'nest-card-texture';
  texture.setAttribute('aria-hidden', 'true');
  return texture;
}

function layerFor(deck, card, className = '') {
  const layer = document.createElement('div');
  layer.className = `nest-card-layer ${className}`.trim();
  layer.append(card);
  deck.mount.append(layer);
  return layer;
}

function decorateBack(back, content = {}, temporary = false) {
  // A pending check owns this visible reverse through the successor turn.
  if (back.checkSlot) return;
  const appearance = resolveBackAppearance(content);
  if (!temporary) back.baseAppearance = appearance;
  const signature = JSON.stringify(appearance);
  if (back.backSignature === signature) return;
  back.backSignature = signature;
  back.backAppearance = appearance;
  back.className = `nest-card nest-card-back${back.checkSlot ? ' nest-check-active' : ''}`;
  back.style.backgroundImage = `url(${JSON.stringify(appearance.background)})`;
  back.replaceChildren(cardTexture(), ...(back.checkSlot ? [back.checkSlot] : []));
  back.backIcons = new Map();
  for (const [key, url] of Object.entries(appearance.icons)) {
    const icon = document.createElement('img');
    icon.className = 'nest-back-icon';
    icon.setAttribute('src', url);
    icon.setAttribute('alt', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.draggable = false;
    icon.hidden = key !== 'default';
    icon.style.transform = `scale(${appearance.iconScale})`;
    back.backIcons.set(key, icon);
    back.append(icon);
  }
  back.setAttribute('data-back-icon', 'default');
}
function backFace(content = {}) {
  const back = document.createElement('article');
  back.setAttribute('aria-hidden', 'true');
  decorateBack(back, content);
  return back;
}

function applyBackAppearance(back, appearance) {
  if (back && appearance) decorateBack(back, { cardBack: appearance }, true);
}

export function backPose(front) {
  return { ...front, face: (front.face || 0) + 180 };
}

export function stageActionDeck(deck, content, selectedIndex = null, previous = null) {
  if (selectedIndex === null) selectedIndex = Math.max(0, content.actions.findIndex(a => a.entrance !== 'bottom'));
  const bundle = { content, selectedIndex, cards: [], cardLayers: [], cardBacks: [], cardTitles: [] };
  const old = new Map(previous?.content.actions.map((a, i) => [a.id, i]) || []);
  const retained = new Set(content.actions.map(action => action.id));
  for (let i = 0; i < (previous?.cards.length || 0); i++) {
    if (!retained.has(previous.content.actions[i].id)) previous.cardLayers[i].remove();
  }
  content.actions.forEach((action, index) => {
    const oldIndex = old.get(action.id);
    if (oldIndex !== undefined) {
      const card = previous.cards[oldIndex], layer = previous.cardLayers[oldIndex];
      const oldAction = previous.content.actions[oldIndex];
      let title = previous.cardTitles[oldIndex], back = previous.cardBacks[oldIndex];
      if (oldAction.label !== action.label || oldAction.heading !== action.heading || oldAction.inventoryLabel !== action.inventoryLabel || oldAction.summary !== action.summary || oldAction.text !== action.text || oldAction.cardKind !== action.cardKind || oldAction.value !== action.value || oldAction.actionEnergyCost !== action.actionEnergyCost || (oldAction.image ?? previous.content.image ?? '') !== (action.image ?? content.image ?? '') || flipped(oldAction) !== flipped(action) || ['imageScale','imageOffsetX','imageOffsetY'].some(key=>oldAction[key]!==action[key])) {
        card.replaceChildren();
        card.style.backgroundImage = '';
        title = deck.decorate(card, action.image ?? content.image ?? '', action.heading || '', action.cardKind ? action.text || '' : action.label, flipped(action), action);
      }
      if (back) decorateBack(back, content);
      if ((action.faceDown || content.decisionOnly) && !back) { back = backFace(content); layer.append(back); }
      if (!action.faceDown && !content.decisionOnly && back) { back.remove(); back = null; }
      bundle.cards.push(card);
      bundle.cardLayers.push(layer);
      bundle.cardBacks.push(back);
      bundle.cardTitles.push(title);
      return;
    }
    const card = document.createElement('article');
    card.className = 'nest-card nest-action';
    bundle.cardTitles.push(deck.decorate(card, action.image ?? content.image ?? '', action.heading || '', action.cardKind ? action.text || '' : action.label, flipped(action), action));
    const layer = layerFor(deck, card);
    bundle.cardLayers.push(layer);
    const back = action.faceDown || content.decisionOnly ? backFace(content) : null;
    if (back) layer.append(back);
    bundle.cardBacks.push(back);
    bundle.cards.push(card);
  });
  bundle.cardTitles.forEach((title, index) => {
    const action = content.actions[index];
    title.hidden = !action.heading || ['event','narrative','caption','action'].includes(action.cardKind);
    if (title.hidden) title.textContent = '';
  });
  return bundle;
}

export function buildDeck(deck, staged = null) {
  deck.mount.setAttribute('aria-label', deck.content.interaction === 'container'
    ? (deck.content.discardAll === true
      ? 'Interactive container. Arrow up reveals or leaves and discards remaining items; down and Enter take the selected item; left and right browse; Escape cancels.'
      : 'Interactive container. Arrow up reveals or discards; down and Enter take items; left and right browse; Escape cancels.')
    : deck.content.directAdvance ? 'Story card. Arrow up or Enter advances; Escape cancels a gesture.' : `Interactive card deck. Arrow up reveals or chooses; left and right browse.${deck.content.allowClose ? ' Down closes.' : ''}`);
  deck.mount.replaceChildren();
  deck.underlay = null;
  deck.underlayLayer = null;
  deck.underlayBack = null;
  const bundle = staged || stageActionDeck(deck, deck.content, deck.index);
  for (const field of ['cards', 'cardLayers', 'cardBacks', 'cardTitles']) deck[field] = bundle[field];
  if (staged) deck.mount.append(...staged.cardLayers);
  deck.scene = document.createElement('article');
  deck.scene.className = 'nest-card nest-situation';
  deck.decorate(deck.scene, deck.content.image, deck.content.heading || '', deck.content.text, deck.content.flipImage, deck.content);
  deck.sceneLayer = layerFor(deck, deck.scene);
  deck.sceneBack = backFace(deck.content);
  deck.sceneLayer.append(deck.sceneBack);
  deck.live = document.createElement('span');
  deck.live.className = 'nest-live';
  deck.live.setAttribute('aria-live', 'polite');
  deck.mount.append(deck.live);
  deck.announce();
}

export function decorateCard(deck, element, image, title, text, flipImage = false, presentation = {}) {
  element.style.backgroundImage = '';
  const artwork = document.createElement('div');
  artwork.className = 'nest-artwork';
  artwork.setAttribute('aria-hidden', 'true');
  const caption = presentation.cardKind === 'caption';
  if (image && !caption) {
    artwork.className += ' nest-artwork-vignetted';
    artwork.style.backgroundImage = `url(${JSON.stringify(image)})`;
    applyArtworkColorize(artwork);
  }
  const transforms = [];
  const scale = presentation.imageScale ?? 100, x = presentation.imageOffsetX ?? 0, y = presentation.imageOffsetY ?? 0;
  if (x || y) transforms.push(`translate(${x}%, ${y}%)`);
  if (scale !== 100) transforms.push(`scale(${scale / 100})`);
  if (flipImage) transforms.push('scaleX(-1)');
  artwork.style.transform = caption ? '' : transforms.join(' ');
  const inventoryAction = presentation.cardKind === 'action' && !!presentation.inventoryLabel;
  element.setAttribute('data-inventory-action', String(inventoryAction));
  const copy = document.createElement('div');
  copy.className = 'nest-copy';
  element.setAttribute('data-card-kind', presentation.cardKind || 'narrative');
  const heading = document.createElement('span');
  heading.className = 'nest-card-title';
  const visibleTitle = ['event','narrative','caption','action'].includes(presentation.cardKind) ? '' : title;
  heading.textContent = visibleTitle || '';
  heading.hidden = !visibleTitle;
  const body = document.createElement('p');
  body.textContent = text || '';
  copy.append(heading);
  const actionCard = presentation.cardKind === 'action';
  if (actionCard) copy.append(body);
  if (presentation.summary) {
    const summary = document.createElement('p');
    summary.className = 'nest-card-summary';
    summary.textContent = presentation.summary;
    copy.append(summary);
  }
  if (presentation.inventoryLabel) {
    const source = document.createElement('p');
    source.className = 'nest-card-inventory';
    source.textContent = presentation.inventoryLabel;
    copy.append(source);
  }
  if (!actionCard) copy.append(body);
  element.append(copy, artwork, cardTexture());
  if (['action','item','health','energy'].includes(presentation.cardKind)) {
    const typeLabel = document.createElement('span');
    typeLabel.className = 'nest-card-type';
    typeLabel.textContent = presentation.cardKind.toUpperCase();
    element.append(typeLabel);
  }
  if (['health','energy'].includes(presentation.cardKind)) {
    const value = document.createElement('span');
    value.className = 'nest-card-value';
    value.textContent = `${presentation.value >= 0 ? '+' : ''}${presentation.value ?? 0}`;
    value.setAttribute('aria-label', `${presentation.cardKind} ${value.textContent}`);
    element.append(value);
  }
  if (actionCard && presentation.actionEnergyCost > 0) {
    const cost = document.createElement('span');
    cost.className = 'nest-action-energy-cost';
    cost.setAttribute('aria-label', `Energy cost: ${presentation.actionEnergyCost}`);
    const amount = document.createElement('span');
    amount.textContent = `-${presentation.actionEnergyCost}`;
    const icon = document.createElement('img');
    icon.setAttribute('src', './assets/img/ui/hud-energy.png');
    icon.setAttribute('alt', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.draggable = false;
    cost.append(amount, icon);
    element.append(cost);
  }
  return heading;
}

// Prepare the physical reverse without requesting or choosing future content.
// The host fills its hidden front only after the gesture commits.
export function stageNextBack(deck) {
  if (!deck.underlay) {
    deck.underlay = document.createElement('article');
    deck.underlay.className = 'nest-card nest-next-situation';
    deck.underlay.setAttribute('aria-hidden', 'true');
    deck.underlayLayer = layerFor(deck, deck.underlay);
    deck.underlayBack = backFace(deck.content);
    deck.underlayLayer.append(deck.underlayBack);
  }
}

// The host's next situation is physically below the departing action cards.
export function stageNextContent(deck, content) {
  stageNextBack(deck);
  decorateBack(deck.underlayBack, { ...deck.content, ...content });
  deck.underlay.replaceChildren();
  deck.underlay.style.backgroundImage = '';
  deck.decorate(deck.underlay, content.image, content.heading || '', content.text, content.flipImage, content);
}

export function announceDeck(deck) {
  const action = deck.content.actions[deck.index];
  const message = deck.phase === 'inserting' ? (deck.entrances.size ? 'Adding inventory choices…' : 'Updating choices…') : deck.phase === 'collecting' ? (deck.collectMotion?.transition === 'discard' ? 'Discarding item…' : 'Taking item…')
    : deck.commitMotion?.discardItem ? 'Discarding item…'
    : deck.commitMotion?.discardAll ? 'Leaving container and discarding remaining items…'
    : deck.busy && deck.flip.x > 0 ? 'Turning next card…' : deck.busy ? (deck.pending || deck.operation === 'commit' ? 'Revealing next card…' : 'Waiting for next card…')
    : deck.phase === 'revealing' ? (deck.content.interaction === 'container' ? 'Uncovering items…' : 'Uncovering choices…')
      : deck.phase === 'closing' ? 'Returning cover…'
      : deck.open && action ? `${deck.entranceAnnouncement || ''}${deck.index + 1} of ${deck.cards.length}: ${action.alreadyOwned ? `Already owned: ${action.label}` : action.disabled ? 'Unavailable choice' : action.accessibleLabel || action.label}`
      : deck.content.title || 'Situation';
  if (deck.live && deck.live.textContent !== message) deck.live.textContent = message;
}

// With the CSS perspective origin at 45% height, the inverse projection
// factor changes by depth/perspective. Compensating Y keeps the top edge
// anchored while preserving Z, scale and every rotation.
function anchorRecedingTop(pose, depth, width, height, perspective) {
  if (!(depth > 0)) return;
  const baseline = { ...pose, z: pose.z + depth };
  const top = projectedBounds(baseline, width, height, perspective).top;
  pose.y += (top - height * .45) * depth / perspective;
}

export function scenePose(deck, time = performance.now(), travel = deck.departureTravel(), bounds = null) {
  const lift = deck.p.x * travel + (deck.commitMotion ? departureDistance(deck.commitMotion, time) : 0);
  const pose = {
    x: 0, y: -lift, z: 16 - deck.n.x * 40 + deck.grabAmount() + Math.min(Math.abs(lift) * 0.08, deck.settings.liftHeight),
    rx: deck.rotationX.x * (1 - clamp(deck.p.x, 0, 1)),
    ry: deck.rotationY.x * (1 - clamp(deck.p.x, 0, 1)),
    turn: clamp(deck.flip.x, 0, 1) * 180, turnAxis: deck.settings.flipAxisTilt,
    rz: deck.rotationZ.x * (1 - clamp(deck.p.x, 0, 1)),
    visible: !deck.skipCover && !(deck.busy && !deck.commitMotion && deck.operation !== 'commit')
  };
  if (!deck.reduced) pose.z += flipLift(deck.flip.x, deck.settings);
  const depth = deck.n.x * 40 * (deck.takeDepthRatio || 0);
  if (depth > 0) {
    const area = bounds || layoutBounds(deck.mount);
    anchorRecedingTop(pose, depth, area.width, area.height, deck.settings.perspective);
  }
  return pose;
}

function orbitRadius(deck, width, height, count = deck.cards.length) {
  if (count < 2) return 18;
  const key = [width, height, count, deck.settings.perspective, deck.settings.stackDepth, deck.settings.maxTilt].join(':');
  if (deck.orbitKey !== key) {
    deck.orbitKey = key;
    deck.orbitRadius = handoffRadius(count, width, height, deck.settings);
  }
  return deck.orbitRadius;
}

function takeProgress(deck, time, height, selected, distanceRatio = .5) {
  if (deck.content.interaction !== 'container' || !selected || selected.disabled || selected.collectDisabled) return 0;
  let distance = (deck.liftStart - deck.l.x) * height;
  if (deck.collectMotion) distance += deck.collectMotion.direction * departureDistance(deck.collectMotion, time);
  const progress = clamp(distance / (height * distanceRatio), 0, 1);
  // Shared ease-out for the item approaching and the stack retreating.
  return 1 - (1 - progress) ** 3;
}

function returningItemDepth(deck, time, height, selected) {
  const returning = deck.itemReturn;
  if (!returning || returning.id !== selected?.id) return takeProgress(deck, time, height, selected);
  // Keep the release boundary continuous, then lose most of the approach
  // depth early. Translation and follower recession retain their own springs.
  const remaining = clamp(deck.l.x / returning.startLift, 0, 1);
  return returning.depth * remaining ** 3;
}

// Share layout and slot indexes only within one synchronous render. Entrances,
// settings and selection may change before the next frame or standalone query.
function poseContext(deck, time) {
  const bounds = layoutBounds(deck.mount);
  const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
  const travel = deck.departureTravel(bounds), front = scenePose(deck, time, travel, bounds);
  const presented = deck.content.actions.flatMap((action, index) => deck.entrances.get(action.id)?.startAt === null ? [] : [index]);
  const slots = new Map(presented.map((index, slot) => [index, slot]));
  const count = Math.max(1, presented.length), selectedSlot = slots.get(deck.index) ?? 0;
  const selected = deck.content.actions.find(action => action.id === deck.liftId);
  const scale = deck.skipCover || deck.reduced ? 1
    : revealScale(height - projectedBounds(front, width, height, deck.settings.perspective).bottom, height, deck.settings);
  return { bounds, width, height, presented, slots, count, selectedSlot, selected, scale, travel, front };
}

export function cardPose(deck, index, time = performance.now(), context = poseContext(deck, time)) {
  const pose = baseCardPose(deck, index, time, context);
  return deck.pickup ? deck.pickup.pose(pose, index) : pose;
}

function baseCardPose(deck, index, time, context) {
  const { bounds, width, height, presented, slots, count, selectedSlot, selected, scale } = context;
  let cursor = deck.commitMotion ? deck.commitMotion.browse : deck.b.x;
  const action = deck.content.actions[index];
  const frozen = deck.liftPoses?.get(action.id);
  if (frozen) {
    const pose = { ...frozen };
    let recession = 0;
    if (action.id === deck.liftId) {
      const lift = (deck.l.x - deck.liftStart) * bounds.height;
      pose.y -= lift;
      if (deck.collectMotion && !deck.collectMotion.deposit) pose.y += deck.collectMotion.direction * departureDistance(deck.collectMotion, time);
      pose.z += Math.min(Math.max(0, lift) * .1, deck.settings.liftHeight);
      pose.z += Math.min(height * .25, deck.settings.perspective * .16) * returningItemDepth(deck, time, height, selected);
      pose.rx += deck.rotationX.x - deck.liftRotation.x;
      pose.ry += deck.rotationY.x - deck.liftRotation.y;
      pose.rz += deck.rotationZ.x - deck.liftRotation.z;
      for (const field of ['rx', 'ry', 'rz']) pose[field] = clamp(pose[field], -deck.settings.maxTilt, deck.settings.maxTilt);
    } else {
      recession = height * .4 * takeProgress(deck, time, height, selected, .45);
      pose.z -= recession;
    }
    pose.z += deck.grabAmount(action.id);
    anchorRecedingTop(pose, recession, width, height, deck.settings.perspective);
    return pose;
  }
  // Cards waiting above the deck do not occupy slots until their entrance starts.
  const slot = slots.get(index) ?? 0;
  if (count !== deck.cards.length) cursor = selectedSlot;
  const radius = orbitRadius(deck, width, height, count);
  const pose = carouselPose(slot, cursor, count, width, deck.settings, radius);
  const fan = clamp(deck.fan.x, 0, 1);
  const rank = ((slot - selectedSlot) % count + count) % count;
  const compressedZ = 4 - deck.n.x * 40 - rank * deck.settings.stackDepth;
  pose.scale = scale;
  const rotationWeight = deck.rotationOwner === 'actions' ? Math.pow(Math.max(0, pose.front), 4) : 0;
  // Friction can carry a tiny amount of the cover's tilt into the compressed
  // cards. Keep it at 12% (and below one degree), fading out as the fan opens.
  const underlyingWeight = deck.rotationOwner === 'situation'
    ? .12 * (1 - clamp(deck.p.x, 0, 1)) * (1 - fan) : 0;
  pose.x *= fan;
  pose.y *= fan;
  pose.z = compressedZ + fan * (pose.z - compressedZ);
  pose.rx = fan * deck.rotationX.x * rotationWeight + clamp(deck.rotationX.x * underlyingWeight, -.9, .9);
  pose.ry = fan * (pose.ry + deck.rotationY.x * rotationWeight) + clamp(deck.rotationY.x * underlyingWeight, -.9, .9);
  pose.rz = fan * (pose.rz + deck.rotationZ.x * rotationWeight) + clamp(deck.rotationZ.x * underlyingWeight, -.9, .9);
  if (deck.presentationHint && presented.length > 1 && slots.has(index)) {
    const progress = clamp(deck.presentationHint.travel.x, 0, 1);
    const radius = handoffRadius(2, width, height, deck.settings);
    const endpoints = context.hintEndpoints ||= [0, 1].map(i => {
      const rest = carouselPose(i, 0, 2, width, deck.settings, radius);
      const peek = carouselPose(i, .24 * progress, 2, width, deck.settings, radius);
      return Object.fromEntries(['x', 'y', 'z', 'ry', 'rz'].map(field => [field, peek[field] - rest[field]]));
    });
    if (presented.length === 2) {
      const delta = endpoints[index === deck.index ? 0 : 1];
      for (const field of ['x', 'y', 'z', 'ry', 'rz']) pose[field] += delta[field] * fan;
    } else if (index === deck.index) {
      pose.x -= width * .02 * progress * fan;
      pose.rz -= .7 * progress * fan;
    } else {
      // Keep left-hand followers moving left and right-hand followers right.
      // Additional followers interpolate between the familiar two-card motions.
      if (!context.hintWeights) {
        const followers = presented.map((i, slot) => ({ i, x: carouselPose(slot, selectedSlot, count, width, deck.settings, radius).x }))
          .filter(card => card.i !== deck.index).sort((a, b) => a.x - b.x || a.i - b.i);
        context.hintWeights = new Map(followers.map((card, index) => [card.i, index / (followers.length - 1)]));
      }
      const weight = context.hintWeights.get(index);
      for (const field of ['x', 'ry', 'rz']) pose[field] += (endpoints[0][field] * (1 - weight) + endpoints[1][field] * weight) * fan;
    }
  }
  if (deck.groupChoiceMotion || index === deck.index) {
    const lift = deck.groupChoiceMotion ? deck.choiceLift(index, time) : deck.l.x * bounds.height;
    pose.y -= lift;
    pose.z += Math.min(lift * .1, deck.settings.liftHeight);
  }
  pose.rx = clamp(pose.rx, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.ry = clamp(pose.ry, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.rz = clamp(pose.rz, -deck.settings.maxTilt, deck.settings.maxTilt);
  if (deck.groupLeaveActive && deck.content.interaction === 'container') {
    // Follow each card's delayed upward travel, including its return on cancel.
    // Keep discard spin separate from the small pointer-tilt limit.
    const travel = clamp(deck.choiceLift(index, time) / (height * .65), 0, 1);
    const id = `${deck.content.id}:${action.id}`;
    const sideways = discardVariation(id, 'side');
    const spin = discardVariation(id, 'spin');
    const curve = discardVariation(id, 'curve');
    pose.x += (sideways < .5 ? -1 : 1) * width * .44
      * (.45 + .55 * discardVariation(id, 'spread')) * travel ** (.85 + .35 * curve);
    const discardSpin = (spin < .5 ? -1 : 1) * 36
      * (.55 + .7 * discardVariation(id, 'rotation')) * travel ** (1.2 - .35 * curve);
    // Rotate the discard motion around a point 12% of the card height below
    // center. Bake the pivot translation into the pose so clearance geometry
    // and captured/reflow poses use the same position as the CSS rendering.
    const pivot = height * .12;
    const angle = discardSpin * Math.PI / 180;
    const base = pose.rz * Math.PI / 180;
    const pivotX = pivot * Math.sin(angle), pivotY = pivot * (1 - Math.cos(angle));
    const dx = Math.cos(base) * pivotX - Math.sin(base) * pivotY;
    const dy = Math.sin(base) * pivotX + Math.cos(base) * pivotY;
    const rx = pose.rx * Math.PI / 180, ry = pose.ry * Math.PI / 180;
    const dz = -Math.sin(ry) * dx;
    pose.x += Math.cos(ry) * dx;
    pose.y += Math.cos(rx) * dy - Math.sin(rx) * dz;
    pose.z += Math.sin(rx) * dy + Math.cos(rx) * dz;
    pose.rz += discardSpin;
  }
  pose.visible = !(deck.phase === 'committing' && deck.busy && !deck.commitMotion && deck.operation !== 'commit')
    && !(deck.busy && deck.operation === 'commit' && !deck.content.decisionOnly && (deck.flip.x !== 0 || deck.flip.v !== 0));
  if (deck.content.decisionOnly) {
    pose.turn = deck.flip.x * 180; pose.turnAxis = deck.settings.flipAxisTilt;
    if (!deck.reduced) pose.z += flipLift(deck.flip.x, deck.settings);
  }
  pose.rank = rank;
  const offset = deck.reflowOffsets.get(action.id);
  if (offset) for (const [field, state] of Object.entries(offset)) pose[field] += state.x;
  pose.z += deck.grabAmount(action.id);
  const entrance = deck.entrances?.get(action.id);
  if (entrance) {
    pose.y -= entrance.travel.x;
    pose.visible &&= entrance.startAt !== null && time >= entrance.startAt;
  }
  anchorRecedingTop(pose, deck.n.x * 40 * (deck.takeDepthRatio || 0), width, height, deck.settings.perspective);
  return pose;
}

function applyPose(deck, element, layer, pose, order, shadow = true) {
  element.style.transform = `translate3d(${pose.x}px,${pose.y}px,${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg)`;
  if (pose.turn !== undefined || pose.face) {
    element.style.transform += ` rotateZ(${pose.turnAxis || 0}deg) rotateY(${pose.turn || 0}deg) rotateZ(${- (pose.turnAxis || 0)}deg) rotateY(${pose.face || 0}deg)`;
  }
  if (pose.scale !== undefined && pose.scale !== 1) element.style.transform += ` scale(${pose.scale})`;
  element.style.visibility = pose.visible ? 'visible' : 'hidden';
  layer.style.zIndex = String(order);
  layer.style.perspective = `${deck.settings.perspective}px`;
  // Elevation changes the footprint of the shadow, never the card's opacity.
  const elevation = Math.max(0, pose.z + 24);
  element.style.boxShadow = shadow
    ? `var(--card-edge-strata, 0 2px 0 #29301c), 0 ${8 + elevation * .16}px ${18 + elevation * .4}px #000b`
    : 'var(--card-edge-strata, none)';
}

export function renderDeck(deck, time = performance.now()) {
  if (!deck.scene) return;
  const context = poseContext(deck, time);
  const { front } = context;
  const poses = deck.cards.map((_, index) => ({ ...cardPose(deck, index, time, context), ...(deck.coverDeparture || deck.content.flipItemsOnReveal ? { visible: false } : {}) }));
  const { width, height } = context;
  const cleared = deck.phase === 'committing' && !deck.commitMotion;
  const coveredBottom = cleared ? 0 : deck.coverDeparture || deck.content.flipItemsOnReveal ? projectedBounds(front, width, height, deck.settings.perspective).bottom : poses.length
    ? Math.max(...poses.map(pose => projectedBounds(pose, width, height, deck.settings.perspective).bottom)) : height;
  const resolution = deck.content.interaction === 'container' && deck.cards.length === 1;
  const movingDown = deck.collectMotion?.direction === 1 || (!deck.collectMotion && deck.l.x < 0);
  const exposure = resolution && movingDown && poses.length
    ? Math.max(0, projectedBounds(poses[0], width, height, deck.settings.perspective).top) : height - coveredBottom;
  const takingLast = resolution && movingDown && context.selected && !context.selected.collectDisabled;
  if (takingLast) deck.nextTakeDepth = height * .4 * takeProgress(deck, time, height, context.selected, .45);
  else if (!deck.backTransition?.takingLast) deck.nextTakeDepth = 0;
  const nextScale = takingLast || deck.nextTakeDepth > 0 || deck.reduced ? 1 : revealScale(exposure, height, deck.settings);
  const appearance = deck.backTransition?.appearance;
  applyBackAppearance(deck.underlayBack, appearance);
  if (deck.underlayBack) {
    const target = deck.content.actions[deck.index]?.checkTarget;
    const checking = Number.isFinite(target) && !deck.pending;
    deck.underlayBack.classList[checking ? 'add' : 'remove']('nest-check-prepared');
  }
  for (const reverse of deck.forwardDeck?.cardBacks || []) applyBackAppearance(reverse, appearance);
  // A staged reverse becomes the actual next card during its flip. Preserve
  // the source appearance until that flip finishes, including async checks.
  if (deck.backTransition && !deck.commitMotion && !deck.collectMotion) {
    applyBackAppearance(deck.sceneBack, appearance);
    for (const reverse of deck.cardBacks) applyBackAppearance(reverse, appearance);
  }
  const forwardActive = !!deck.forwardDeck && (((deck.content.directAdvance || deck.content.flipItemsOnReveal) && !deck.busy && deck.p.x > 0) || (deck.phase === 'committing' && deck.pendingPresentation === 'open')
    || (deck.phase === 'choices' && deck.l.x > 0 && deck.forwardOwner === deck.content.actions[deck.index]?.id));
  if (deck.underlay) {
    const stagedPose = {
      x: 0, y: 0, z: -24 - (deck.nextTakeDepth || 0), rx: 0, ry: 0, rz: 0, scale: nextScale,
      turn: deck.nextFlip.x * 180, turnAxis: deck.settings.flipAxisTilt,
      visible: (((deck.content.directAdvance || deck.content.flipItemsOnReveal) && deck.p.x > 0 && !deck.busy) || (deck.phase === 'committing' && (!!deck.commitMotion || deck.operation !== 'commit')) || (deck.phase === 'collecting' && deck.collectMotion?.final)
        || (deck.phase === 'choices' && (deck.content.interaction === 'container' ? (resolution && deck.l.x !== 0) || (deck.groupLeaveActive && deck.l.x > 0) : deck.l.x > 0)
        && !deck.content.actions[deck.index]?.disabled))
        && !forwardActive && !deck.ending && !deck.content.noSuccessor
    };
    if (!deck.reduced) stagedPose.z += flipLift(deck.nextFlip.x, deck.settings);
    anchorRecedingTop(stagedPose, deck.nextTakeDepth || 0, width, height, deck.settings.perspective);
    applyPose(deck, deck.underlay, deck.underlayLayer, stagedPose, 0);
    applyPose(deck, deck.underlayBack, deck.underlayLayer, backPose(stagedPose), 0);
  }
  const forwardTurns = deck.pending?.decisionOnly && deck.pendingTransition === 'flip'
    || !deck.busy && (deck.content.flipItemsOnReveal || deck.content.directAdvance && deck.content.nextTransition === 'flip') && deck.forwardDeck?.content.decisionOnly;
  renderStagedActions(deck, deck.forwardDeck, 20, forwardActive, 0, -36 - (deck.nextTakeDepth || 0), nextScale, forwardTurns ? deck.nextFlip.x * 180 : 0, true, deck.nextTakeDepth || 0, context.bounds);
  renderStagedActions(deck, deck.returnDeck, 500,
    (deck.phase === 'closing' && deck.returning)
      || deck.returnLift.x > 0,
    -(1 - clamp(deck.returnLift.x, 0, 1)) * context.travel,
    deck.cards.length && (deck.returning || deck.returnLift.x > 0) ? 4 : -36, 1);
  applyPose(deck, deck.scene, deck.sceneLayer, front, 1000);
  applyPose(deck, deck.sceneBack, deck.sceneLayer, backPose(front), 1000);
  deck.scene.setAttribute('aria-hidden', String(deck.open || deck.busy));
  const painterOrder = poses.map((pose, index) => ({ index, depth: deck.fan.x === 0 ? -pose.rank : pose.front }));
  painterOrder.sort((a, b) => a.depth - b.depth || b.index - a.index);
  painterOrder.forEach(({ index }, order) => {
    order = deck.reflowOrder?.get(deck.content.actions[index].id) ?? 100 + order;
    applyPose(deck, deck.cards[index], deck.cardLayers[index], poses[index], order, deck.fan.x > 0);
    if (deck.content.actions[index].faceDown) {
      applyPose(deck, deck.cards[index], deck.cardLayers[index], backPose(poses[index]), order, deck.fan.x > 0);
      applyPose(deck, deck.cardBacks[index], deck.cardLayers[index], { ...poses[index], face: 360 }, order, deck.fan.x > 0);
    }
    if (deck.content.decisionOnly && deck.cardBacks[index]) applyPose(deck, deck.cardBacks[index], deck.cardLayers[index], backPose(poses[index]), order, deck.fan.x > 0);
    deck.cards[index].setAttribute('aria-disabled', String(!!(deck.content.actions[index].disabled || deck.content.actions[index].alreadyOwned)));
    if (deck.content.actions[index].faceDown) deck.cards[index].setAttribute('aria-label', deck.content.actions[index].accessibleLabel || 'Unavailable choice');
    else deck.cards[index].removeAttribute('aria-label');
    deck.cards[index].setAttribute('aria-hidden', String(deck.phase !== 'choices' || deck.busy || index !== deck.index));
  });
  announceDeck(deck);
}

function renderStagedActions(deck, bundle, baseOrder, visible, y = 0, z = -36, scale = 1, turn = 0, suppressEntrances = false, takeDepth = 0, bounds = null) {
  if (!bundle) return;
  const presented = bundle.content.actions.flatMap((action, i) => suppressEntrances && action.entrance === 'bottom' ? [] : [i]);
  const slots = new Map(presented.map((index, slot) => [index, slot]));
  const count = Math.max(1, presented.length), selectedSlot = slots.get(bundle.selectedIndex) ?? 0;
  bundle.cards.forEach((card, index) => {
    const rank = ((slots.get(index) ?? 0) - selectedSlot + count) % count;
    const pose = { x: 0, y, z: z - rank * deck.settings.stackDepth, rx: 0, ry: 0, rz: 0, scale, visible: visible && !(suppressEntrances && bundle.content.actions[index].entrance === 'bottom'), turn, turnAxis: deck.settings.flipAxisTilt };
    if (!deck.reduced) pose.z += flipLift(turn / 180, deck.settings);
    if (takeDepth > 0) {
      anchorRecedingTop(pose, takeDepth, bounds.width, bounds.height, deck.settings.perspective);
    }
    const order = baseOrder + bundle.cards.length - rank;
    applyPose(deck, card, bundle.cardLayers[index], bundle.content.actions[index].faceDown ? backPose(pose) : pose, order);
    if (bundle.cardBacks[index]) applyPose(deck, bundle.cardBacks[index], bundle.cardLayers[index], bundle.content.actions[index].faceDown ? { ...pose, face: 360 } : backPose(pose), order);
    card.setAttribute('aria-hidden', 'true');
  });
}

export function restoreBacks(deck) {
  for (const back of [deck.sceneBack, ...deck.cardBacks, deck.underlayBack, ...(deck.forwardDeck?.cardBacks || [])]) {
    if (!back) continue;
    decorateBack(back, { cardBack: back.baseAppearance });
  }
}
