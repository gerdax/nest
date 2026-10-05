import { carouselPose, clamp, departureDistance } from './motion.js';

export function buildDeck(deck) {
  deck.mount.replaceChildren();
  deck.underlay = document.createElement('article');
  deck.underlay.className = 'nest-card nest-underlay';
  deck.underlay.setAttribute('aria-hidden', 'true');
  deck.decorate(deck.underlay, null, 'NEST', '');
  deck.mount.append(deck.underlay);

  deck.cards = deck.content.actions.map((action, index) => {
    const card = document.createElement('article');
    card.className = 'nest-card nest-action';
    deck.decorate(card, action.image || deck.content.image,
      `ACTION ${String(index + 1).padStart(2, '0')} / ${deck.content.actions.length}`, action.label);
    deck.mount.append(card);
    return card;
  });
  deck.scene = document.createElement('article');
  deck.scene.className = 'nest-card nest-situation';
  deck.decorate(deck.scene, deck.content.image, deck.content.title, deck.content.text);
  deck.mount.append(deck.scene);
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
  deck.underlay.replaceChildren();
  deck.underlay.style.backgroundImage = '';
  deck.decorate(deck.underlay, content.image, content.title, content.text);
}

export function announceDeck(deck) {
  const message = deck.busy ? (deck.pending ? 'Revealing next card…' : 'Waiting for next card…')
    : deck.open ? `${deck.index + 1} of ${deck.cards.length}: ${deck.content.actions[deck.index].label}`
      : deck.content.title || 'Situation';
  if (deck.live && deck.live.textContent !== message) deck.live.textContent = message;
}

export function scenePose(deck, time = performance.now()) {
  const lift = deck.p.x * deck.departureTravel() + (deck.commitMotion ? departureDistance(deck.commitMotion, time) : 0);
  return {
    x: 0, y: -lift, z: 16 - deck.n.x * 40 + Math.min(Math.abs(lift) * 0.08, deck.settings.liftHeight),
    rx: deck.rotationX.x * (1 - clamp(deck.p.x, 0, 1)),
    ry: deck.rotationY.x * (1 - clamp(deck.p.x, 0, 1)),
    rz: deck.rotationZ.x * (1 - clamp(deck.p.x, 0, 1)),
    visible: !(deck.busy && !deck.commitMotion && deck.operation !== 'commit')
  };
}

export function cardPose(deck, index, time = performance.now()) {
  const bounds = deck.mount.getBoundingClientRect();
  const cursor = deck.commitMotion ? deck.commitMotion.browse : deck.b.x;
  const pose = carouselPose(index, cursor, deck.cards.length, bounds.width, deck.settings);
  const exposure = clamp(deck.p.x, 0, 1);
  // Cards already sit under the situation. Nothing is introduced from below.
  pose.z += (1 - exposure) * (4 - deck.n.x * 40);
  const rotationWeight = Math.pow(Math.max(0, pose.front), 4);
  pose.rx = deck.rotationX.x * rotationWeight;
  pose.ry += deck.rotationY.x * rotationWeight;
  pose.rz += deck.rotationZ.x * rotationWeight;
  pose.y -= deck.l.x * bounds.height;
  pose.z += Math.min(deck.l.x * bounds.height * 0.1, deck.settings.liftHeight);
  if (deck.commitMotion) {
    pose.y -= departureDistance(deck.commitMotion, time);
  }
  pose.rx = clamp(pose.rx, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.ry = clamp(pose.ry, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.rz = clamp(pose.rz, -deck.settings.maxTilt, deck.settings.maxTilt);
  pose.visible = !(deck.busy && !deck.commitMotion && deck.operation !== 'commit');
  return pose;
}

function applyPose(element, pose, order) {
  element.style.transform = `translate3d(${pose.x}px,${pose.y}px,${pose.z}px) rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) rotateZ(${pose.rz}deg)`;
  element.style.visibility = pose.visible ? 'visible' : 'hidden';
  element.style.zIndex = String(order);
  // Elevation changes the footprint of the shadow, never the card's opacity.
  const elevation = Math.max(0, pose.z + 24);
  element.style.boxShadow = `0 3px 0 #29301c, 0 ${8 + elevation * .16}px ${18 + elevation * .4}px #000b`;
}

export function renderDeck(deck, time = performance.now()) {
  if (!deck.scene) return;
  deck.mount.style.perspective = `${deck.settings.perspective}px`;
  applyPose(deck.underlay, { x: 0, y: 0, z: -24, rx: 0, ry: 0, rz: 0, visible: true }, 0);
  applyPose(deck.scene, scenePose(deck, time), 200);
  deck.scene.setAttribute('aria-hidden', String(deck.open || deck.busy));
  deck.cards.forEach((card, index) => {
    const pose = cardPose(deck, index, time);
    applyPose(card, pose, 100 + Math.round(pose.front * 20));
    card.setAttribute('aria-hidden', String(!deck.open || deck.busy || index !== deck.index));
  });
  announceDeck(deck);
}
