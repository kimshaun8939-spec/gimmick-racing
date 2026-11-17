// Map-owned visual presets; unknown maps never opt in implicitly.
import { settings } from './settings.js';
export const GFX_MAPS = new Set(['glacier', 'starter', 'sea', 'jungle', 'neon', 'mirage', 'foundry']);
export const MAP_GRADES = {
 mirage: {contrast:1.003,saturation:1.006,vignette:.025,bloom:.025,cool:[1,1,1],warm:[1.002,1,1]},
 foundry: {contrast:1.004,saturation:1.006,vignette:.03,bloom:.07,cool:[1,1,1],warm:[1.003,1.001,1]},
 jungle: {contrast:1.003,saturation:1.006,vignette:.025,bloom:.025,cool:[1,1,1],warm:[1,1,1]},
 neon: {contrast:1.004,saturation:1.008,vignette:.025,bloom:.085,cool:[.999,1,1.002],warm:[1.001,1,1]},
 glacier: { contrast: 1.008, saturation: .995, vignette: .045, bloom: .11, cool: [.997,1,1.004], warm: [1.004,1.001,.998] },
 sea: {contrast:1.004,saturation:1.008,vignette:.025,bloom:.03,cool:[1,1,1],warm:[1.003,1.001,1]},
 starter: { contrast: 1.004, saturation: 1.008, vignette: .025, bloom: .055, cool: [1,1,1], warm: [1.002,1.001,1] }
};
export const NEUTRAL_GRADE = {contrast:1,saturation:1,vignette:0,bloom:0,cool:[1,1,1],warm:[1,1,1]};
export function gfxEnabled(map = new URLSearchParams(location.search).get('map'), quality = settings.get('quality')) {
 const force = new URLSearchParams(location.search).get('gfx');
 return GFX_MAPS.has(map) && force !== '0' && (force === '2' || quality !== 'low');
}
