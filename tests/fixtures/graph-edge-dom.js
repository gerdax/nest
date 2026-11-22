// Minimal SVG projection for GraphView's DOM-free event tests.
export function installGraphEdgeDom(layer, Element) {
  let fragments = [];
  let gesture;
  layer.querySelector = selector => selector === '#graph-gesture' ? gesture : undefined;
  Object.defineProperty(layer, 'innerHTML', {
    configurable: true,
    get: () => fragments.map(fragment => fragment.markup).join('') + (gesture ? `<g id="graph-gesture">${gesture.innerHTML}</g>` : ''),
    set: html => {
      const wireMarkup = html.replace('<g id="graph-gesture"></g>', '');
      gesture = {innerHTML:''};
      fragments = [...wireMarkup.matchAll(/<(?:path|text) class="([^"]+)"([^>]*?)(?:\/>|>[^<]*<\/text>)/g)].map(([markup, className, attrs]) => {
        const dataset = Object.fromEntries([...attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)]
          .map(([, key, value]) => [key.replace(/-(\w)/g, (_, char) => char.toUpperCase()), value]));
        const element = new Element(className, dataset);
        const fragment = {markup, element};
        const setAttribute = element.setAttribute.bind(element);
        element.setAttribute = (name, value) => {
          setAttribute(name, value);
          fragment.markup = fragment.markup.replace(new RegExp(`( ${name}=")[^"]*"`), (_, prefix) => `${prefix}${value}"`);
        };
        return fragment;
      });
      layer.children = fragments.map(fragment => fragment.element);
    },
  });
}
