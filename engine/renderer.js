import { handoffRadius, projectedBounds } from './geometry.js?v=grab-camera-1';
import { carouselPose, clamp, departureDistance, revealScale } from './motion.js?v=grab-camera-1';

function layerFor(deck, card, className = '') {
  const layer = document.createElement('div');
  layer.className = `nest-card-layer ${className}`.trim();
  layer.append(card);
  deck.mount.append(layer);
  return layer;
}

function backFace() {
  const back = document.createElement('article');
  back.className = 'nest-card nest-card-back';
  back.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  frame.className = 'nest-back-frame';
  const mark = document.createElement('span');
  mark.className = 'nest-back-mark';
  mark.textContent = 'NEST';
  frame.append(mark);
  back.append(frame);
  return back;
}

export function backPose(front) {
  return { ...front, face: (front.face || 0) + 180 };
}

export function stageActionDeck(deck, content, selectedIndex = 0, previous = null) {
  const bundle = { content, selectedIndex, cards: [], cardLayers: [], cardBacks: [], cardTitles: [] };
  const old = new Map(previous?.content.actions.map((a, i) => [a.id, i]) || []);
  for (let i = 0; i < (previous?.cards.length || 0); i++) {
    if (!content.actions.some(a => a.id === previous.content.actions[i].id)) previous.cardLayers[i].remove();
  }
  content.actions.forEach((action, index) => {
    const oldIndex = old.get(action.id);
    if (oldIndex !== undefined) {
      const card = previous.cards[oldIndex], layer = previous.cardLayers[oldIndex];
      const oldAction = previous.content.actions[oldIndex];
      let title = previous.cardTitles[oldIndex], back = previous.cardBacks[oldIndex];
      if (oldAction.label !== action.label || (oldAction.image || previous.content.image) !== (action.image || content.image)) {
        card.replaceChildren();
        card.style.backgroundImage = '';
        title = deck.decorate(card, action.image || content.image, '', action.label);
      }
      if (action.faceDown && !back) { back = backFace(); layer.append(back); }
      if (!action.faceDown && back) { back.remove(); back = null; }
      bundle.cards.push(card);
      bundle.cardLayers.push(layer);
      bundle.cardBacks.push(back);
      bundle.cardTitles.push(title);
      return;
    }
    const card = document.createElement('article');
    card.className = 'nest-card nest-action';
    bundle.cardTitles.push(deck.decorate(card, action.image || content.image, '', action.label));
    const layer = layerFor(deck, card);
    bundle.cardLayers.push(layer);
    const back = action.faceDown ? backFace() : null;
    if (back) layer.append(back);
    bundle.cardBacks.push(back);
    bundle.cards.push(card);
  });
  bundle.cardTitles.forEach((title, i) => {
    title.textContent = `${content.interaction === 'container' ? 'ITEM' : 'ACTION'} ${String(i + 1).padStart(2, '0')} / ${content.actions.length}`;
  });
  return bundle;
}

export function buildDeck(deck, staged = null) {
  deck.mount.setAttribute('aria-label', deck.content.interaction === 'container'
    ? 'Interactive container. Arrow up reveals or discards; down and Enter take items; left and right browse; Escape cancels.'
    : `Interactive card deck. Arrow up reveals or chooses; left and right browse.${deck.content.allowClose ? ' Down closes.' : ''}`);
  deck.mount.replaceChildren();
  deck.underlay = null;
  deck.underlayLayer = null;
  deck.underlayBack = null;
  const bundle = staged || stageActionDeck(deck, deck.content, deck.index);
  for (const field of ['cards', 'cardLayers', 'cardBacks', 'cardTitles']) deck[field] = bundle[field];
  if (staged) deck.mount.append(...staged.cardLayers);
  deck.scene = document.createElement('article');
  deck.scene.className = 'nest-card nest-situation';
  deck.decorate(deck.scene, deck.content.image, deck.content.title, deck.content.text);
  deck.sceneLayer = layerFor(deck, deck.scene);
  deck.sceneBack = backFace();
  deck.sceneLayer.append(deck.sceneBack);
  deck.live = document.createElement('span');
  deck.live.className = 'nest-live';
  deck.live.setAttribute('aria-live', 'polite');
  deck.mount.append(deck.live);
  deck.announce();
}

export function decorateCard(deck, element, image, title, text) {
  if (image) element.style.backgroundImage = `url(${JSON.stringify(image)})`;
  const copy = document.createElement('div');
  copy.className = 'nest-copy';
  const heading = document.createElement('span');
  heading.className = 'nest-card-title';
  heading.textContent = title || '';
  const body = document.createElement('p');
  body.textContent = text || '';
  copy.append(heading, body);
  element.append(copy);
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
    deck.underlayBack = backFace();
    deck.underlayLayer.append(deck.underlayBack);
  }
}

// The host's next situation is physically below the departing action cards.
export function stageNextContent(deck, content) {
  stageNextBack(deck);
  deck.underlay.replaceChildren();
  deck.underlay.style.backgroundImage = '';
  deck.decorate(deck.underlay, content.image, content.title, content.text);
}

export function announceDeck(deck) {
  const action = deck.content.actions[deck.index];
  const message = deck.phase === 'collecting' ? (deck.collectMotion?.transition === 'discard' ? 'Discarding item…' : 'Taking item…')
    : deck.busy && deck.flip.x > 0 ? 'Turning next card…' : deck.busy ? (deck.pending || deck.operation === 'commit' ? 'Revealing next card…' : 'Waiting for next card…')
    : deck.phase === 'revealing' ? (deck.content.interaction === 'container' ? 'Uncovering items…' : 'Uncovering choices…')
      : deck.phase === 'closing' ? 'Returning cover…'
      : deck.open && action ? `${deck.index + 1} of ${deck.cards.length}: ${action.disabled ? 'Unavailable choice' : action.accessibleLabel || action.label}`
      : deck.content.title || 'Situation';
  if (deck.live && deck.live.textContent !== message) deck.live.textContent = message;
}

export function scenePose(deck, time = performance.now()) {
  const lift = deck.p.x * deck.departureTravel() + (deck.commitMotion ? departureDistance(deck.commitMotion, time) : 0);
  const pose = {
    x: 0, y: -lift, z: 16 - deck.n.x * 40 + deck.grabAmount() + Math.min(Math.abs(lift) * 0.08, deck.settings.liftHeight),
    rx: deck.rotationX.x * (1 - clamp(deck.p.x, 0, 1)),
    ry: deck.rotationY.x * (1 - clamp(deck.p.x, 0, 1)),
    turn: clamp(deck.flip.x, 0, 1) * 180, turnAxis: deck.settings.flipAxisTilt,
    rz: deck.rotationZ.x * (1 - clamp(deck.p.x, 0, 1)),
    visible: !deck.skipCover && !(deck.busy && !deck.commitMotion && deck.operation !== 'commit')
  };
  return pose;
}

function orbitRadius(deck, width, height) {
  if (deck.cards.length < 2) return 18;
  const key = [width, height, deck.cards.length, deck.settings.perspective, deck.settings.stackDepth, deck.settings.maxTilt].join(':');
  if (deck.orbitKey !== key) {
    deck.orbitKey = key;
    deck.orbitRadius = handoffRadius(deck.cards.length, width, height, deck.settings);
  }
  return deck.orbitRadius;
}

export function cardPose(deck, index, time = performance.now()) {
  const bounds = deck.mount.getBoundingClientRect();
  const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
  const cursor = deck.commitMotion ? deck.commitMotion.browse : deck.b.x;
  const action = deck.content.actions[index];
  const frozen = deck.liftPoses?.get(action.id);
  if (frozen) {
    const pose = { ...frozen };
    if (action.id === deck.liftId) {
      const lift = (deck.l.x - deck.liftStart) * bounds.height;
      pose.y -= lift;
      if (deck.collectMotion) pose.y += deck.collectMotion.direction * departureDistance(deck.collectMotion, time);
      pose.z += Math.min(Math.max(0, lift) * .1, deck.settings.liftHeight);
      pose.rx += deck.rotationX.x - deck.liftRotation.x;
      pose.ry += deck.rotationY.x - deck.liftRotation.y;
      pose.rz += deck.rotationZ.x - deck.liftRotation.z;
      for (const field of ['rx', 'ry', 'rz']) pose[field] = clamp(pose[field], -deck.settings.maxTilt, deck.settings.maxTilt);
    }
    pose.z += deck.grabAmount(action.id);
    return pose;
  }
  const pose = carouselPose(index, cursor, deck.cards.length, width, deck.settings, orbitRadius(deck, width, height));
  const fan = clamp(deck.fan.x, 0, 1);
  const rank = ((index - deck.index) % deck.cards.length + deck.cards.length) % deck.cards.length;
  const compressedZ = 4 - deck.n.x * 40 - rank * deck.settings.stackDepth;
  pose.scale = deck.skipCover || deck.reduced ? 1
    : revealScale(height - projectedBounds(scenePose(deck, time), width, height, deck.settings.perspective).bottom, height, deck.settings);
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
  if (deck.content.interaction !== 'container' || index === deck.index) {
    const lift = deck.content.interaction === 'choice' ? deck.choiceLift(index, time) : deck.l.x * bounds.height;
    pose.y -= lift;
    pose.z += Math.min(lift * .1, deck.settings.liftHeight);
  }
  pose.rx = clamp(pose.rx, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.ry = clamp(pose.ry, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.rz = clamp(pose.rz, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.visible = !(deck.phase === 'committing' && deck.busy && !deck.commitMotion && deck.operation !== 'commit')
    && !(deck.busy && deck.operation === 'commit' && (deck.flip.x !== 0 || deck.flip.v !== 0));
  pose.rank = rank;
  const offset = deck.reflowOffsets.get(action.id);
  if (offset) for (const [field, state] of Object.entries(offset)) pose[field] += state.x;
  pose.z += deck.grabAmount(action.id);
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
  element.style.boxShadow = shadow ? `0 2px 0 #29301c, 0 ${8 + elevation * .16}px ${18 + elevation * .4}px #000b` : 'none';
}

export function renderDeck(deck, time = performance.now()) {
  if (!deck.scene) return;
  const front = scenePose(deck, time);
  const poses = deck.cards.map((_, index) => cardPose(deck, index, time));
  const bounds = deck.mount.getBoundingClientRect();
  const width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
  const cleared = deck.phase === 'committing' && !deck.commitMotion;
  const coveredBottom = cleared ? 0 : poses.length
    ? Math.max(...poses.map(pose => projectedBounds(pose, width, height, deck.settings.perspective).bottom)) : height;
  const resolution = deck.content.interaction === 'container' && deck.cards.length === 1;
  const movingDown = deck.collectMotion?.direction === 1 || (!deck.collectMotion && deck.l.x < 0);
  const exposure = resolution && movingDown && poses.length
    ? Math.max(0, projectedBounds(poses[0], width, height, deck.settings.perspective).top) : height - coveredBottom;
  const nextScale = deck.reduced ? 1 : revealScale(exposure, height, deck.settings);
  const forwardActive = !!deck.forwardDeck && ((deck.phase === 'committing' && deck.pendingPresentation === 'open')
    || (deck.phase === 'choices' && deck.l.x > 0 && deck.forwardOwner === deck.content.actions[deck.index]?.id));
  if (deck.underlay) {
    const stagedPose = {
      x: 0, y: 0, z: -24, rx: 0, ry: 0, rz: 0, scale: nextScale,
      turn: deck.nextFlip.x * 180, turnAxis: deck.settings.flipAxisTilt,
      visible: (deck.phase === 'committing' || (deck.phase === 'collecting' && deck.collectMotion?.final)
        || (deck.phase === 'choices' && (deck.content.interaction === 'container' ? resolution && deck.l.x !== 0 : deck.l.x > 0)
        && !deck.content.actions[deck.index]?.disabled))
        && !forwardActive
    };
    applyPose(deck, deck.underlay, deck.underlayLayer, stagedPose, 0);
    applyPose(deck, deck.underlayBack, deck.underlayLayer, backPose(stagedPose), 0);
  }
  renderStagedActions(deck, deck.forwardDeck, 20, forwardActive, 0, -36, nextScale);
  renderStagedActions(deck, deck.returnDeck, 500,
    (deck.phase === 'closing' && deck.returning)
      || deck.returnLift.x > 0,
    -(1 - clamp(deck.returnLift.x, 0, 1)) * deck.departureTravel(),
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
    deck.cards[index].setAttribute('aria-disabled', String(!!deck.content.actions[index].disabled));
    if (deck.content.actions[index].faceDown) deck.cards[index].setAttribute('aria-label', deck.content.actions[index].accessibleLabel || 'Unavailable choice');
    else deck.cards[index].removeAttribute('aria-label');
    deck.cards[index].setAttribute('aria-hidden', String(deck.phase !== 'choices' || deck.busy || index !== deck.index));
  });
  announceDeck(deck);
}

function renderStagedActions(deck, bundle, baseOrder, visible, y = 0, z = -36, scale = 1) {
  if (!bundle) return;
  bundle.cards.forEach((card, index) => {
    const rank = (index - bundle.selectedIndex + bundle.cards.length) % bundle.cards.length;
    const pose = { x: 0, y, z: z - rank * deck.settings.stackDepth, rx: 0, ry: 0, rz: 0, scale, visible };
    const order = baseOrder + bundle.cards.length - rank;
    applyPose(deck, card, bundle.cardLayers[index], bundle.content.actions[index].faceDown ? backPose(pose) : pose, order);
    if (bundle.cardBacks[index]) applyPose(deck, bundle.cardBacks[index], bundle.cardLayers[index], { ...pose, face: 360 }, order);
    card.setAttribute('aria-hidden', 'true');
  });
}
