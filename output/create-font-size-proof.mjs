import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const project = JSON.parse(readFileSync(new URL('../examples/serene-pod/WF2D-1050-serene-pod.lvproj.json', import.meta.url), 'utf8'));
project.uiProject.meta.name = 'PodsC icon sizes 8-48px (local verification)';
const home = project.uiProject.screens[0];
project.uiProject.screens = [home];
home.isHome = true;
home.root.children = [];
function label(text, x, y, width, height, size) {
  return { id: `obj:${randomUUID()}`, type: 'label', codeName: `proof_${home.root.children.length}`,
    props: { text, x, y, width, height }, flags: [], states: [], events: [], bindings: [], children: [],
    styles: [{ props: { text_font: `montserrat_${size}`, text_color: '#4A3426' } }] };
}
for (let size = 8; size <= 48; size += 2) {
  const index = (size - 8) / 2;
  const x = 28 + (index % 7) * 142;
  const y = 35 + Math.floor(index / 7) * 180;
  home.root.children.push(label(`${size} px`, x, y, 135, 28, 18));
  home.root.children.push(label('\uf52b', x, y + 42, 130, 85, size));
}
writeFileSync(new URL('./font-size-proof.lvproj.json', import.meta.url), JSON.stringify(project));
