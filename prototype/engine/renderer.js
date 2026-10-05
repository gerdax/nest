import { handoffRadius } from './geometry.js';
import { carouselPose, clamp, departureDistance } from './motion.js';

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
  return { ...front, ry: front.ry + 180 };
}

export function buildDeck(deck) {
  deck.mount.replaceChildren();
  deck.underlay = null;
  deck.underlayLayer = null;
  deck.underlayBack = null;
  deck.cardLayers = [];
  deck.cards = deck.content.actions.map((action, index) => {
    const card = document.createElement('article');
    card.className = 'nest-card nest-action';
    deck.decorate(card, action.image || deck.content.image,
      `ACTION ${String(index + 1).padStart(2, '0')} / ${deck.content.actions.length}`, action.label);
    deck.cardLayers.push(layerFor(deck, card));
    return card;
  });
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
}

// The host's next situation is physically below the departing action cards.
export function stageNextContent(deck, content) {
  if (!deck.underlay) {
    deck.underlay = document.createElement('article');
    deck.underlay.className = 'nest-card nest-next-situation';
    deck.underlay.setAttribute('aria-hidden', 'true');
    deck.underlayLayer = layerFor(deck, deck.underlay);
    deck.underlayBack = backFace();
    deck.underlayLayer.append(deck.underlayBack);
  }
  deck.underlay.replaceChildren();
  deck.underlay.style.backgroundImage = '';
  deck.decorate(deck.underlay, content.image, content.title, content.text);
}

export function announceDeck(deck) {
  const message = deck.busy && deck.flip.x > 0 ? 'Turning next card…' : deck.busy ? (deck.pending || deck.operation === 'commit' ? 'Revealing next card…' : 'Waiting for next card…')
    : deck.phase === 'revealing' ? 'Uncovering choices…'
      : deck.phase === 'closing' ? 'Returning cover…'
      : deck.open ? `${deck.index + 1} of ${deck.cards.length}: ${deck.content.actions[deck.index].label}`
      : deck.content.title || 'Situation';
  if (deck.live && deck.live.textContent !== message) deck.live.textContent = message;
}

export function scenePose(deck, time = performance.now()) {
  const lift = deck.p.x * deck.departureTravel() + (deck.commitMotion ? departureDistance(deck.commitMotion, time) : 0);
  return {
    x: 0, y: -lift, z: 16 - deck.n.x * 40 + Math.min(Math.abs(lift) * 0.08, deck.settings.liftHeight),
    rx: deck.rotationX.x * (1 - clamp(deck.p.x, 0, 1)),
    ry: deck.rotationY.x * (1 - clamp(deck.p.x, 0, 1)) + clamp(deck.flip.x, 0, 1) * 180,
    rz: deck.rotationZ.x * (1 - clamp(deck.p.x, 0, 1)),
    visible: !(deck.busy && !deck.commitMotion && deck.operation !== 'commit')
  };
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
  const pose = carouselPose(index, cursor, deck.cards.length, width, deck.settings, orbitRadius(deck, width, height));
  const fan = clamp(deck.fan.x, 0, 1);
  const exposure = clamp(deck.p.x, 0, 1);
  const rank = ((index - deck.index) % deck.cards.length + deck.cards.length) % deck.cards.length;
  const compressedZ = 4 - deck.n.x * 40 - rank * deck.settings.stackDepth;
  const rotationWeight = Math.pow(Math.max(0, pose.front), 4);
  const sharedX = deck.rotationX.x * (1 - exposure);
  const sharedY = deck.rotationY.x * (1 - exposure);
  const sharedZ = deck.rotationZ.x * (1 - exposure);
  pose.x *= fan;
  pose.y *= fan;
  pose.z = compressedZ + fan * (pose.z - compressedZ);
  pose.rx = sharedX + fan * (deck.rotationX.x * rotationWeight - sharedX);
  pose.ry = sharedY + fan * (pose.ry + deck.rotationY.x * rotationWeight - sharedY);
  pose.rz = sharedZ + fan * (pose.rz + deck.rotationZ.x * rotationWeight - sharedZ);
  pose.y -= deck.l.x * bounds.height;
  pose.z += Math.min(deck.l.x * bounds.height * .1, deck.settings.liftHeight);
  if (deck.commitMotion) pose.y -= departureDistance(deck.commitMotion, time);
  pose.rx = clamp(pose.rx, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.ry = clamp(pose.ry, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.rz = clamp(pose.rz, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.visible = !(deck.busy && !deck.commitMotion && deck.operation !== 'commit')
    && !(deck.busy && deck.operation === 'commit' && (deck.flip.x !== 0 || deck.flip.v !== 0));
  pose.rank = rank;
  return pose;
}

function applyPose(deck, element, layer, pose, order, shadow = true) {
  element.style.transform = `translate3d(${pose.x}px,${pose.y}px,${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg)`;
  element.style.visibility = pose.visible ? 'visible' : 'hidden';
  layer.style.zIndex = String(order);
  layer.style.perspective = `${deck.settings.perspective}px`;
  // Elevation changes the footprint of the shadow, never the card's opacity.
  const elevation = Math.max(0, pose.z + 24);
  element.style.boxShadow = shadow ? `0 3px 0 #29301c, 0 ${8 + elevation * .16}px ${18 + elevation * .4}px #000b` : 'none';
}

export function renderDeck(deck, time = performance.now()) {
  if (!deck.scene) return;
  if (deck.underlay) {
    const stagedPose = { x: 0, y: 0, z: -24, rx: 0, ry: 180, rz: 0, visible: true };
    applyPose(deck, deck.underlay, deck.underlayLayer, stagedPose, 0);
    applyPose(deck, deck.underlayBack, deck.underlayLayer, backPose(stagedPose), 0);
  }
  const front = scenePose(deck, time);
  applyPose(deck, deck.scene, deck.sceneLayer, front, 1000);
  applyPose(deck, deck.sceneBack, deck.sceneLayer, backPose(front), 1000);
  deck.scene.setAttribute('aria-hidden', String(deck.open || deck.busy));
  const poses = deck.cards.map((_, index) => cardPose(deck, index, time));
  const painterOrder = poses.map((pose, index) => ({ index, depth: deck.fan.x === 0 ? -pose.rank : pose.front }));
  painterOrder.sort((a, b) => a.depth - b.depth || b.index - a.index);
  painterOrder.forEach(({ index }, order) => {
    applyPose(deck, deck.cards[index], deck.cardLayers[index], poses[index], 100 + order, deck.fan.x > 0);
    deck.cards[index].setAttribute('aria-hidden', String(deck.phase !== 'choices' || deck.busy || index !== deck.index));
  });
  announceDeck(deck);
}
